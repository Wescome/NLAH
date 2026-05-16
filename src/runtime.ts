import { randomUUID } from "node:crypto";
import { mkdir, copyFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadHarness, compileHarness, type CompiledHarness } from "./compiler.js";
import { FsArtifactManager, type ArtifactManager } from "./artifacts.js";
import { TraceLogger } from "./trace.js";
import { evaluateGateSpec } from "./gates.js";
import type { RuntimeResult, RuntimeState } from "./state.js";
import { RuntimeError } from "./errors.js";
import { DeterministicWorkerAdapter, type WorkerAdapter, type WorkerOutput } from "./workers.js";
import { buildStageContext, roleNameToFileName } from "./context.js";
import type { WorkerRegistry } from "./worker_registry.js";

// ---------------------------------------------------------------------------
// Pure event-driven harness API (contribution #1c)
// ---------------------------------------------------------------------------
//
// The original `runHarness()` below is a blocking in-memory loop that owns the
// state machine, the filesystem, the worker adapter, and the trace logger. It
// works well in Node contexts but cannot be paused between stages, which is
// exactly what a Cloudflare Worker Durable Object needs: each stage completes
// in its own invocation, persists state, and the next invocation resumes.
//
// `initHarness` and `advanceHarness` extract the *pure* state-machine portion
// of `runHarness` as two functions with no I/O and no side effects. The caller
// (a Durable Object, a Queue consumer, a test harness) is responsible for:
//
//   1. Persisting the HarnessState between calls.
//   2. Dispatching the next stage to a worker when advance returns
//      { action: 'dispatch' }.
//   3. Evaluating gates and reporting the results back via StageResult.
//
// These functions intentionally know nothing about artifact managers, trace
// loggers, or filesystem paths. That contract is what makes them runnable in
// the Workers environment.

// Current state of a running harness — persisted by the caller across stage
// completions. Replaces the role of the in-memory loop variables in
// `runHarness` (currentState, repairRoundsUsed, retryCounters) with an
// explicit serializable record.
export interface HarnessState {
  runId: string;
  currentStage: string;
  completedStages: string[];
  stageAttempts: Record<string, number>;
  totalAttempts: number;
  status: "running" | "complete" | "failed";
  result?: HarnessRunResult;
}

// Result of one stage completing — produced by the caller (Queue consumer or
// DO step) and fed back into `advanceHarness`. The pure function does not
// invoke workers or gates; it only interprets their outcomes.
export interface StageResult {
  stageName: string;
  workerOutput: WorkerOutput;
  gateResults: GateResult[];
}

// Single gate evaluation outcome. `gateName` should be the gate id when
// available so traces and retry decisions can be correlated with the
// `GateContract.id` field from the harness spec.
export interface GateResult {
  gateName: string;
  passed: boolean;
  detail?: string;
}

// Lightweight result type for the pure API. The legacy `RuntimeResult` in
// `./state.ts` carries filesystem paths (runRoot, tracePath, summaryPath)
// that pure functions cannot know — those are the I/O wrapper's
// responsibility. `HarnessRunResult` carries only what the state machine
// itself can decide.
export interface HarnessRunResult {
  overall: "pass" | "fail";
  finalStage: string;
  reason?: string;
  failureClass?: string;
}

// What `advanceHarness` returns. Tells the caller what to do next:
//   - 'dispatch': run the named stage now.
//   - 'retry':    re-run the same stage (gate failure, attempts remain).
//   - 'return':   placeholder for return_to_stage semantics added in
//                 contribution #2; never produced by this 0.1 implementation
//                 but kept in the union so consumers can switch exhaustively
//                 today and just gain a real path tomorrow.
//   - 'complete': harness reached a terminal state successfully.
//   - 'fail':     harness exhausted retries or hit an unrecoverable failure.
export type HarnessAdvance =
  | { action: "dispatch"; stage: string; newState: HarnessState }
  | { action: "retry"; stage: string; newState: HarnessState }
  | { action: "return"; stage: string; newState: HarnessState }
  | { action: "complete"; result: HarnessRunResult; newState: HarnessState }
  | { action: "fail"; result: HarnessRunResult; newState: HarnessState };

// Default per-stage attempt budget when the harness spec does not specify one
// via `runtime.max_repair_rounds`. Kept conservative — the caller can raise
// the budget by tuning the spec rather than touching this constant.
const DEFAULT_STAGE_ATTEMPT_BUDGET = 3;

function resolveFirstStageName(compiled: CompiledHarness): string {
  // `compiled.startState` names a *state*, not a stage. In linear mode the
  // compiler guarantees exactly one stage leaves that state. We resolve it
  // here so callers can stash a stage name in `HarnessState.currentStage`
  // directly.
  const candidates = compiled.stagesByFromState[compiled.startState] ?? [];
  const first = candidates[0];
  if (!first) {
    throw new RuntimeError(
      `no enabled stage for start state: ${compiled.startState}`
    );
  }
  return first.name;
}

function resolveNextStageName(
  compiled: CompiledHarness,
  fromState: string
): { kind: "terminal" } | { kind: "stage"; name: string } {
  if (compiled.terminalStates.includes(fromState)) {
    return { kind: "terminal" };
  }
  const candidates = compiled.stagesByFromState[fromState] ?? [];
  const next = candidates[0];
  if (!next) {
    // No outgoing stage and not a recognized terminal state — treat as
    // terminal anyway so the caller can resolve to `complete`. The compiler
    // already rejects unreachable states, so this is defensive.
    return { kind: "terminal" };
  }
  return { kind: "stage", name: next.name };
}

function stageAttemptBudget(compiled: CompiledHarness): number {
  const fromSpec = compiled.spec.runtime.max_repair_rounds;
  if (typeof fromSpec === "number" && fromSpec > 0) {
    return fromSpec;
  }
  return DEFAULT_STAGE_ATTEMPT_BUDGET;
}

// Initialize a new harness run. Pure: no I/O, no clocks, no randomness.
// Caller supplies the runId so it can be reproduced across DO invocations.
export function initHarness(
  compiled: CompiledHarness,
  context: { taskText: string; runId: string }
): HarnessState {
  // `taskText` is part of the documented signature so the caller can pass
  // the task body in from R2 / KV, but the pure state machine itself does
  // not need it — workers consume it through their own input. We accept it
  // for API symmetry and to keep the signature stable as the function
  // grows to record more provenance in future contributions.
  void context.taskText;

  return {
    runId: context.runId,
    currentStage: resolveFirstStageName(compiled),
    completedStages: [],
    stageAttempts: {},
    totalAttempts: 0,
    status: "running"
  };
}

// Advance the harness by one stage completion. Pure: no I/O.
//
// Decision tree:
//   1. If any gate failed, increment the stage's attempt count. If the
//      budget is exhausted, return 'fail'. Otherwise return 'retry'.
//   2. If all gates passed, mark the stage complete. If the stage's `to`
//      state is terminal, return 'complete'. Otherwise return 'dispatch'
//      for the next stage from `to`.
//
// The function never mutates its inputs — `newState` is a fresh object.
export function advanceHarness(
  compiled: CompiledHarness,
  state: HarnessState,
  result: StageResult
): HarnessAdvance {
  const stageSpec = compiled.spec.stages[result.stageName];
  if (!stageSpec) {
    const failed: HarnessRunResult = {
      overall: "fail",
      finalStage: result.stageName,
      reason: `unknown stage: ${result.stageName}`,
      failureClass: "unknown_stage"
    };
    return {
      action: "fail",
      result: failed,
      newState: {
        ...state,
        completedStages: [...state.completedStages],
        stageAttempts: { ...state.stageAttempts },
        status: "failed",
        result: failed
      }
    };
  }

  const previousAttempts = state.stageAttempts[result.stageName] ?? 0;
  const nextAttempts = previousAttempts + 1;
  const failedGate = result.gateResults.find((gate) => !gate.passed);

  if (failedGate) {
    const budget = stageAttemptBudget(compiled);
    const stageAttempts: Record<string, number> = {
      ...state.stageAttempts,
      [result.stageName]: nextAttempts
    };
    const baseState: HarnessState = {
      ...state,
      completedStages: [...state.completedStages],
      stageAttempts,
      totalAttempts: state.totalAttempts + 1
    };

    if (nextAttempts >= budget) {
      const reason =
        `gate failed: ${failedGate.gateName}` +
        (failedGate.detail ? `: ${failedGate.detail}` : "") +
        ` (budget exceeded: ${nextAttempts}/${budget})`;
      const failed: HarnessRunResult = {
        overall: "fail",
        finalStage: result.stageName,
        reason,
        failureClass: "budget_exceeded"
      };
      return {
        action: "fail",
        result: failed,
        newState: { ...baseState, status: "failed", result: failed }
      };
    }

    return {
      action: "retry",
      stage: result.stageName,
      newState: { ...baseState, currentStage: result.stageName, status: "running" }
    };
  }

  // All gates passed. Record completion and choose the next destination.
  const completedStages = state.completedStages.includes(result.stageName)
    ? [...state.completedStages]
    : [...state.completedStages, result.stageName];
  const stageAttempts: Record<string, number> = {
    ...state.stageAttempts,
    [result.stageName]: nextAttempts
  };

  const next = resolveNextStageName(compiled, stageSpec.to);
  if (next.kind === "terminal") {
    const passed: HarnessRunResult = {
      overall: "pass",
      finalStage: result.stageName
    };
    return {
      action: "complete",
      result: passed,
      newState: {
        ...state,
        currentStage: result.stageName,
        completedStages,
        stageAttempts,
        totalAttempts: state.totalAttempts + 1,
        status: "complete",
        result: passed
      }
    };
  }

  return {
    action: "dispatch",
    stage: next.name,
    newState: {
      ...state,
      currentStage: next.name,
      completedStages,
      stageAttempts,
      totalAttempts: state.totalAttempts + 1,
      status: "running"
    }
  };
}

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
    const artifacts = new FsArtifactManager(runRoot, compiled.spec);
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

  const artifacts = new FsArtifactManager(runRoot, compiled.spec);
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
