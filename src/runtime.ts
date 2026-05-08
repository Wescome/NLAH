import { randomUUID } from "node:crypto";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { loadHarness, compileHarness } from "./compiler.js";
import { ArtifactManager } from "./artifacts.js";
import { TraceLogger } from "./trace.js";
import { evaluateGateSpec } from "./gates.js";
import type { RuntimeResult, RuntimeState } from "./state.js";
import { RuntimeError } from "./errors.js";
import { DeterministicWorkerAdapter, type WorkerAdapter } from "./workers.js";

function roleSlug(roleName: string): string {
  return roleName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

async function loadRolePrompt(harnessPath: string, roleName: string): Promise<string | undefined> {
  const rolePath = path.resolve(path.dirname(harnessPath), "..", "roles", `${roleSlug(roleName)}.md`);
  try {
    return await readFile(rolePath, "utf8");
  } catch {
    return undefined;
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
  runId?: string,
  workerAdapter: WorkerAdapter = new DeterministicWorkerAdapter()
): Promise<RuntimeResult> {
  runId ??= randomUUID();
  const resolvedHarnessPath = path.resolve(harnessPath);
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedTaskPath = path.resolve(taskPath);
  const compiled = compileHarness(await loadHarness(resolvedHarnessPath));

  const runRoot = path.resolve("runs", runId);
  const stateRoot = path.join(runRoot, "state");
  const artifactRoot = path.join(runRoot, "artifacts");
  const tracePath = path.join(stateRoot, "task_history.jsonl");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await copyFile(resolvedTaskPath, path.join(runRoot, "TASK.md"));

  const artifacts = new ArtifactManager(runRoot, compiled.spec);
  const logger = new TraceLogger(tracePath, runId);
  const state: RuntimeState = {
    runId,
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
    runId,
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

      const rolePrompt = await loadRolePrompt(resolvedHarnessPath, stageEntry.spec.role);
      const workerInput = {
        stageName: stageEntry.name,
        roleName: stageEntry.spec.role,
        state,
        declaredInputs: stageEntry.spec.inputs,
        declaredOutputs: stageEntry.spec.outputs,
        ...(rolePrompt === undefined ? {} : { rolePrompt })
      };
      const workerOutput = await workerAdapter.execute(workerInput, artifacts);

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
