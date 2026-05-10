import { randomUUID } from "node:crypto";
import { mkdir, copyFile, rm, stat, writeFile } from "node:fs/promises";
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
  overwriteRun?: boolean;
};

type NormalizedRunHarnessOptions = {
  runId: string;
  workerAdapter?: WorkerAdapter;
  workerRegistry?: WorkerRegistry;
  overwriteRun: boolean;
};

function normalizeRunHarnessOptions(
  runIdOrOptions?: string | RunHarnessOptions,
  workerAdapter?: WorkerAdapter
): NormalizedRunHarnessOptions {
  if (typeof runIdOrOptions === "string" || runIdOrOptions === undefined) {
    return {
      runId: runIdOrOptions ?? randomUUID(),
      ...(workerAdapter === undefined ? {} : { workerAdapter }),
      overwriteRun: false
    };
  }

  return {
    runId: runIdOrOptions.runId ?? randomUUID(),
    ...(runIdOrOptions.workerAdapter === undefined ? {} : { workerAdapter: runIdOrOptions.workerAdapter }),
    ...(runIdOrOptions.workerRegistry === undefined ? {} : { workerRegistry: runIdOrOptions.workerRegistry }),
    overwriteRun: runIdOrOptions.overwriteRun ?? false
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
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
  message: string,
  artifacts: ArtifactManager,
  details?: {
    failureClass?: string;
    action?: string;
    failedStage?: string;
    failedGateId?: string;
    retryCounters?: Record<string, number>;
    warnings?: string[];
  }
): Promise<RuntimeResult> {
  await logger.emit("run_failed", {
    message,
    ...(details?.failureClass ? { failureClass: details.failureClass } : {}),
    ...(details?.action ? { action: details.action } : {}),
    ...(details?.failedStage ? { stage: details.failedStage } : {}),
    ...(details?.failedGateId ? { gateId: details.failedGateId } : {}),
    ...(details?.retryCounters ? { retryCounters: details.retryCounters } : {})
  });
  const runtimeResult: RuntimeResult = {
    ...result,
    status: "FAIL",
    message,
    ...(details?.failureClass ? { failureClass: details.failureClass } : {}),
    ...(details?.action ? { action: details.action } : {}),
    ...(details?.retryCounters ? { retryCounters: details.retryCounters } : {}),
    ...(details?.warnings ? { warnings: details.warnings } : {})
  };
  await writeRunSummary(runtimeResult, artifacts);
  return runtimeResult;
}

async function writeRunSummary(result: RuntimeResult, artifacts: ArtifactManager): Promise<void> {
  const summary = {
    runId: result.runId,
    status: result.status,
    finalState: result.finalState,
    runRoot: result.runRoot,
    artifactRoot: result.artifactRoot,
    tracePath: result.tracePath,
    ...(result.message === undefined ? {} : { message: result.message }),
    ...(result.failureClass === undefined ? {} : { failureClass: result.failureClass }),
    ...(result.action === undefined ? {} : { action: result.action }),
    ...(result.retryCounters === undefined ? {} : { retryCounters: result.retryCounters }),
    ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
    artifacts: await artifacts.allStatuses()
  };
  await mkdir(path.dirname(result.summaryPath), { recursive: true });
  await writeFile(result.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
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
  const stateRoot = path.join(runRoot, compiled.spec.runtime.state_root);
  const artifactRoot = path.join(runRoot, compiled.spec.runtime.artifact_root);
  const tracePath = path.join(stateRoot, "task_history.jsonl");
  const summaryPath = path.join(runRoot, "summary.json");

  if (options.overwriteRun) {
    await rm(runRoot, { recursive: true, force: true });
  } else if (await pathExists(runRoot)) {
    const artifacts = new ArtifactManager(runRoot, compiled.spec);
    const logger = new TraceLogger(tracePath, options.runId);
    const resultBase = {
      runId: options.runId,
      finalState: compiled.startState,
      runRoot,
      artifactRoot,
      tracePath,
      summaryPath
    };
    await logger.emit("run_started", { fromState: compiled.startState });
    return failRun(logger, resultBase, `run directory already exists: ${runRoot}`, artifacts, {
      failureClass: "run_already_exists",
      action: "abort",
      warnings: compiled.warnings
    });
  }

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
    tracePath,
    summaryPath
  };

  async function emitTrace(
    event: string,
    payload: Parameters<TraceLogger["emit"]>[1] = {}
  ): Promise<void> {
    state.stageHistory.push(await logger.emit(event, payload));
  }

  let repairRoundsUsed = 0;
  const retryCounters: Record<string, number> = {};
  function maxRetriesReached(): boolean {
    const maxTotalRetries = compiled.spec.runtime.max_total_retries ?? compiled.spec.runtime.max_repair_rounds;
    return repairRoundsUsed >= compiled.spec.runtime.max_repair_rounds || repairRoundsUsed >= maxTotalRetries;
  }

  async function tryRepair(
    failureKey: string,
    sourceStage: string,
    message: string
  ): Promise<{ repaired: boolean; action: string; failureClass?: string }> {
    const stageAction = compiled.spec.stages[sourceStage]?.on_failure?.[failureKey];
    const action = stageAction ?? compiled.spec.failure_taxonomy?.[failureKey] ?? compiled.spec.runtime.default_failure_action;
    if (!action || action === "abort") {
      return { repaired: false, action: action ?? "abort" };
    }
    if (maxRetriesReached()) {
      return { repaired: false, action, failureClass: "budget_exceeded" };
    }

    if (action === "retry_stage") {
      repairRoundsUsed += 1;
      retryCounters[sourceStage] = (retryCounters[sourceStage] ?? 0) + 1;
      await emitTrace("repair_started", {
        stage: sourceStage,
        fromState: state.currentState,
        toState: state.currentState,
        message: `${failureKey}: ${message}`,
        failureClass: failureKey,
        action,
        retryCounters
      });
      return { repaired: true, action };
    }

    if (action.startsWith("return_to_")) {
      const targetStageName = action.slice("return_to_".length);
      const targetStage = compiled.spec.stages[targetStageName];
      if (!targetStage) {
        return { repaired: false, action };
      }
      const previousState = state.currentState;
      state.currentState = targetStage.from;
      repairRoundsUsed += 1;
      retryCounters[sourceStage] = (retryCounters[sourceStage] ?? 0) + 1;
      await emitTrace("repair_started", {
        stage: sourceStage,
        fromState: previousState,
        toState: state.currentState,
        message: `${failureKey}: ${message}`,
        failureClass: failureKey,
        action,
        retryCounters
      });
      await emitTrace("state_transition", {
        stage: sourceStage,
        fromState: previousState,
        toState: state.currentState,
        message: `repair action: ${action}`,
        failureClass: failureKey,
        action,
        retryCounters
      });
      return { repaired: true, action };
    }

    return { repaired: false, action };
  }

  await emitTrace("run_started", { fromState: state.currentState });

  try {
    execution:
    while (!compiled.terminalStates.includes(state.currentState)) {
      const stages = compiled.stagesByFromState[state.currentState] ?? [];
      if (stages.length === 0) {
        throw new RuntimeError(`no enabled stage for state: ${state.currentState}`);
      }
      const stageEntry = [...stages].sort((a, b) => a.name.localeCompare(b.name))[0];
      if (!stageEntry) {
        throw new RuntimeError(`no enabled stage for state: ${state.currentState}`);
      }

      await emitTrace("stage_started", {
        stage: stageEntry.name,
        role: stageEntry.spec.role,
        worker: stageEntry.spec.worker ?? "default",
        fromState: stageEntry.spec.from,
        toState: stageEntry.spec.to,
        inputArtifacts: stageEntry.spec.inputs,
        outputArtifacts: stageEntry.spec.outputs
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
      const roleSpec = compiled.spec.roles[stageEntry.spec.role];
      const context = await buildStageContext({
        taskPath: resolvedTaskPath,
        rolePath,
        declaredInputs: stageEntry.spec.inputs,
        declaredOutputs: stageEntry.spec.outputs,
        ...(roleSpec === undefined
          ? {}
          : {
              rolePolicy: {
                ...(roleSpec.reads === undefined ? {} : { reads: roleSpec.reads }),
                ...(roleSpec.writes === undefined ? {} : { writes: roleSpec.writes }),
                ...(roleSpec.must_not === undefined ? {} : { must_not: roleSpec.must_not })
              }
            }),
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
      await emitTrace(
        "worker_completed",
        workerOutput.message === undefined
          ? { stage: stageEntry.name }
          : { stage: stageEntry.name, message: workerOutput.message }
      );

      for (const artifact of workerOutput.createdArtifacts) {
        state.artifacts[artifact] = await artifacts.status(artifact);
        await emitTrace("artifact_created", {
          stage: stageEntry.name,
          role: stageEntry.spec.role,
          worker: stageEntry.spec.worker ?? "default",
          artifact,
          path: state.artifacts[artifact]?.path,
          producerStage: stageEntry.name,
          producerRole: stageEntry.spec.role,
          inputArtifacts: stageEntry.spec.inputs
        });
      }

      for (const output of stageEntry.spec.outputs) {
        const status = await artifacts.status(output);
        if (!status.exists || (status.sizeBytes ?? 0) === 0) {
          const message = `missing required output artifact: ${output}`;
          const repair = await tryRepair("missing_artifact", stageEntry.name, message);
          if (repair.repaired) {
            continue execution;
          }
          return failRun(
            logger,
            { ...resultBase, finalState: state.currentState },
            message,
            artifacts,
            {
              failureClass: repair.failureClass ?? "missing_artifact",
              action: repair.action,
              failedStage: stageEntry.name,
              retryCounters,
              warnings: compiled.warnings
            }
          );
        }
        const contractResult = await artifacts.validateContract(output);
        if (!contractResult.passed) {
          const repair = await tryRepair("invalid_artifact", stageEntry.name, contractResult.message);
          if (repair.repaired) {
            continue execution;
          }
          return failRun(
            logger,
            { ...resultBase, finalState: state.currentState },
            contractResult.message,
            artifacts,
            {
              failureClass: repair.failureClass ?? "invalid_artifact",
              action: repair.action,
              failedStage: stageEntry.name,
              retryCounters,
              warnings: compiled.warnings
            }
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
        await emitTrace(gate.passed ? "gate_passed" : "gate_failed", {
          ...payload,
          ...(gate.id ? { gateId: gate.id } : {}),
          ...(gate.uses ? { uses: gate.uses } : {}),
          ...(gate.reads ? { reads: gate.reads } : {}),
          ...(gate.proves ? { proves: gate.proves } : {}),
          ...(gate.failureClass ? { failureClass: gate.failureClass } : {}),
          ...(gate.memberResults ? { memberResults: gate.memberResults } : {})
        });
      }
      const failedGate = gateResults.find((gate) => !gate.passed);
      if (failedGate) {
        const message = `gate failed: ${failedGate.gate}: ${failedGate.message ?? ""}`.trim();
        const failureClass = failedGate.failureClass ?? failedGate.gate;
        const repair = await tryRepair(failureClass, stageEntry.name, message);
        if (repair.repaired) {
          continue execution;
        }
        return failRun(
          logger,
          { ...resultBase, finalState: state.currentState },
          message,
          artifacts,
          {
            failureClass: repair.failureClass ?? failureClass,
            action: repair.action,
            failedStage: stageEntry.name,
            ...(failedGate.id ? { failedGateId: failedGate.id } : {}),
            retryCounters,
            warnings: compiled.warnings
          }
        );
      }

      const previousState = state.currentState;
      state.currentState = stageEntry.spec.to;
      await emitTrace("state_transition", {
        stage: stageEntry.name,
        fromState: previousState,
        toState: state.currentState,
        passedGateIds: gateResults.filter((gate) => gate.passed).map((gate) => gate.id ?? gate.gate),
        producedArtifacts: stageEntry.spec.outputs
      });
      await emitTrace("stage_completed", {
        stage: stageEntry.name,
        fromState: previousState,
        toState: state.currentState
      });
    }

    await emitTrace("run_completed", { toState: state.currentState });
    const runtimeResult: RuntimeResult = {
      ...resultBase,
      status: "PASS",
      finalState: state.currentState,
      retryCounters,
      warnings: compiled.warnings
    };
    await writeRunSummary(runtimeResult, artifacts);
    return runtimeResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failRun(logger, { ...resultBase, finalState: state.currentState }, message, artifacts);
  }
}
