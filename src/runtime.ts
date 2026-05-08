import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadHarness, compileHarness } from "./compiler.js";
import { ArtifactManager } from "./artifacts.js";
import { TraceLogger } from "./trace.js";
import { evaluateGateSpec } from "./gates.js";
import type { RuntimeResult, RuntimeState } from "./state.js";
import { RuntimeError } from "./errors.js";
import { DeterministicWorkerAdapter, type WorkerAdapter } from "./workers.js";
import { buildStageContext, roleNameToFileName } from "./context.js";
import type { WorkerRegistry } from "./worker_registry.js";

export type RunHarnessOptions = {
  runId?: string;
  workerAdapter?: WorkerAdapter;
  workerRegistry?: WorkerRegistry;
};

type NormalizedRunHarnessOptions = {
  runId: string;
  workerAdapter?: WorkerAdapter;
  workerRegistry?: WorkerRegistry;
};

function normalizeRunHarnessOptions(
  runIdOrOptions?: string | RunHarnessOptions,
  workerAdapter?: WorkerAdapter
): NormalizedRunHarnessOptions {
  if (typeof runIdOrOptions === "string" || runIdOrOptions === undefined) {
    return {
      runId: runIdOrOptions ?? randomUUID(),
      ...(workerAdapter === undefined ? {} : { workerAdapter })
    };
  }

  return {
    runId: runIdOrOptions.runId ?? randomUUID(),
    ...(runIdOrOptions.workerAdapter === undefined ? {} : { workerAdapter: runIdOrOptions.workerAdapter }),
    ...(runIdOrOptions.workerRegistry === undefined ? {} : { workerRegistry: runIdOrOptions.workerRegistry })
  };
}

function validateWorkerCreatedArtifacts(declaredOutputs: string[], createdArtifacts: string[]): void {
  const declared = new Set(declaredOutputs);
  const created = new Set(createdArtifacts);

  for (const artifact of created) {
    if (!declared.has(artifact)) {
      throw new RuntimeError(`undeclared artifact returned by worker: ${artifact}`);
    }
  }

  for (const artifact of declared) {
    if (!created.has(artifact)) {
      throw new RuntimeError(`missing declared artifact from worker result: ${artifact}`);
    }
  }
}

async function failRun(
  logger: TraceLogger,
  result: Omit<RuntimeResult, "status">,
  message: string
): Promise<RuntimeResult> {
  await logger.emit("run_failed", { message });
  return {
    ...result,
    status: "FAIL",
    message
  };
}

export async function runHarness(
  harnessPath: string,
  repoPath: string,
  taskPath: string,
  runIdOrOptions?: string | RunHarnessOptions,
  workerAdapter?: WorkerAdapter
): Promise<RuntimeResult> {
  const options = normalizeRunHarnessOptions(runIdOrOptions, workerAdapter);
  const fallbackWorkerAdapter = new DeterministicWorkerAdapter();
  const resolvedHarnessPath = path.resolve(harnessPath);
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedTaskPath = path.resolve(taskPath);
  const compiled = compileHarness(await loadHarness(resolvedHarnessPath));

  const runRoot = path.resolve("runs", options.runId);
  const stateRoot = path.join(runRoot, "state");
  const artifactRoot = path.join(runRoot, "artifacts");
  const tracePath = path.join(stateRoot, "task_history.jsonl");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await copyFile(resolvedTaskPath, path.join(runRoot, "TASK.md"));

  const artifacts = new ArtifactManager(runRoot, compiled.spec);
  const logger = new TraceLogger(tracePath, options.runId);
  const state: RuntimeState = {
    runId: options.runId,
    currentState: compiled.startState,
    taskPath: resolvedTaskPath,
    repoPath: resolvedRepoPath,
    harnessPath: resolvedHarnessPath,
    runRoot,
    stateRoot,
    artifactRoot,
    stageHistory: [],
    artifacts: {}
  };

  const resultBase = {
    runId: options.runId,
    finalState: state.currentState,
    runRoot,
    artifactRoot,
    tracePath
  };

  await logger.emit("run_started", { fromState: state.currentState });

  try {
    while (!compiled.terminalStates.includes(state.currentState)) {
      const stages = compiled.stagesByFromState[state.currentState] ?? [];
      if (stages.length === 0) {
        throw new RuntimeError(`no enabled stage for state: ${state.currentState}`);
      }
      const stageEntry = [...stages].sort((a, b) => a.name.localeCompare(b.name))[0];
      if (!stageEntry) {
        throw new RuntimeError(`no enabled stage for state: ${state.currentState}`);
      }

      await logger.emit("stage_started", {
        stage: stageEntry.name,
        fromState: stageEntry.spec.from,
        toState: stageEntry.spec.to
      });

      const stageWorker =
        options.workerAdapter ??
        (options.workerRegistry
          ? stageEntry.spec.worker
            ? options.workerRegistry.get(stageEntry.spec.worker)
            : options.workerRegistry.getDefault()
          : fallbackWorkerAdapter);

      const rolePath = path.resolve(
        path.dirname(resolvedHarnessPath),
        "..",
        "roles",
        roleNameToFileName(stageEntry.spec.role)
      );
      const context = await buildStageContext({
        taskPath: resolvedTaskPath,
        rolePath,
        declaredInputs: stageEntry.spec.inputs,
        declaredOutputs: stageEntry.spec.outputs,
        artifacts
      });
      const workerInput = {
        stageName: stageEntry.name,
        roleName: stageEntry.spec.role,
        context,
        state,
        declaredInputs: stageEntry.spec.inputs,
        declaredOutputs: stageEntry.spec.outputs
      };
      const workerOutput = await stageWorker.execute(workerInput, artifacts);
      validateWorkerCreatedArtifacts(stageEntry.spec.outputs, workerOutput.createdArtifacts);
      await logger.emit(
        "worker_completed",
        workerOutput.message === undefined
          ? { stage: stageEntry.name }
          : { stage: stageEntry.name, message: workerOutput.message }
      );

      for (const artifact of workerOutput.createdArtifacts) {
        state.artifacts[artifact] = await artifacts.status(artifact);
        await logger.emit("artifact_created", { stage: stageEntry.name, artifact });
      }

      for (const output of stageEntry.spec.outputs) {
        const status = await artifacts.status(output);
        if (!status.exists || (status.sizeBytes ?? 0) === 0) {
          return failRun(
            logger,
            { ...resultBase, finalState: state.currentState },
            `missing required output artifact: ${output}`
          );
        }
      }

      const gateResults = await evaluateGateSpec(stageEntry.spec.gate, state, artifacts);
      for (const gate of gateResults) {
        const payload =
          gate.message === undefined
            ? {
                stage: stageEntry.name,
                gate: gate.gate,
                passed: gate.passed
              }
            : {
                stage: stageEntry.name,
                gate: gate.gate,
                passed: gate.passed,
                message: gate.message
              };
        await logger.emit(gate.passed ? "gate_passed" : "gate_failed", {
          ...payload
        });
      }
      const failedGate = gateResults.find((gate) => !gate.passed);
      if (failedGate) {
        return failRun(
          logger,
          { ...resultBase, finalState: state.currentState },
          `gate failed: ${failedGate.gate}: ${failedGate.message ?? ""}`.trim()
        );
      }

      const previousState = state.currentState;
      state.currentState = stageEntry.spec.to;
      await logger.emit("state_transition", {
        stage: stageEntry.name,
        fromState: previousState,
        toState: state.currentState
      });
      await logger.emit("stage_completed", {
        stage: stageEntry.name,
        fromState: previousState,
        toState: state.currentState
      });
    }

    await logger.emit("run_completed", { toState: state.currentState });
    return {
      ...resultBase,
      status: "PASS",
      finalState: state.currentState
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failRun(logger, { ...resultBase, finalState: state.currentState }, message);
  }
}
