import crypto from "node:crypto";
import path from "node:path";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ArtifactManager } from "./artifacts";
import { compileHarness, loadHarness } from "./compiler";
import { evaluateGateSpec } from "./gates";
import type { StageSpec } from "./schema";
import type { RuntimeState } from "./state";
import { TraceLogger } from "./trace";
import { NlahError } from "./errors";

export type RuntimeStatus = "PASS" | "FAIL" | "INCOMPLETE";

export type RuntimeResult = {
  runId: string;
  status: RuntimeStatus;
  state: string;
  runRoot: string;
  artifacts: string[];
  tracePath: string;
  error?: string;
};

function roleSlug(role: string): string {
  return role
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

async function listRepoFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", "runs", "dist"].includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return results.sort();
}

async function loadRolePolicy(harnessPath: string, role: string): Promise<string> {
  const rolePath = path.resolve(path.dirname(harnessPath), "..", "roles", `${roleSlug(role)}.md`);
  if (!existsSync(rolePath)) {
    throw new NlahError(`missing role policy file: ${rolePath}`);
  }
  return readFile(rolePath, "utf8");
}

function buildCandidatePatch(): string {
  return [
    "diff --git a/src/message.txt b/src/message.txt",
    "--- a/src/message.txt",
    "+++ b/src/message.txt",
    "@@ -1 +1 @@",
    "-hello from nlah",
    "+hello from nlah runtime",
    ""
  ].join("\n");
}

async function executeRoleStub(
  stage: StageSpec,
  state: RuntimeState,
  artifacts: ArtifactManager,
  rolePolicy: string
): Promise<string[]> {
  const created: string[] = [];
  const task = await readFile(state.taskPath, "utf8");
  const repoFiles = await listRepoFiles(state.repoPath);

  for (const output of stage.outputs) {
    if (output === "IssueContract") {
      await artifacts.writeText(
        output,
        [
          "# Issue Contract",
          "",
          "## Task",
          task.trim(),
          "",
          "## Acceptance Contract",
          "- Runtime must produce declared artifacts.",
          "- Gates must pass before state transitions."
        ].join("\n")
      );
    } else if (output === "RepoMap") {
      await artifacts.writeText(
        output,
        [
          "# Repository Map",
          "",
          "## Problem summary",
          "The target repository contains a message fixture that the candidate patch updates.",
          "",
          "## Relevant files",
          ...(repoFiles.length > 0 ? repoFiles.map((file) => `- ${file}`) : ["- src/message.txt"]),
          "",
          "## Relevant tests",
          "- git apply --check candidate.patch",
          "",
          "## Suspected root cause",
          "The fixture text does not match the desired runtime wording.",
          "",
          "## Blast-radius risks",
          "- Patch should remain limited to src/message.txt.",
          "",
          "<!-- role policy loaded -->",
          rolePolicy.trim().slice(0, 200)
        ].join("\n")
      );
    } else if (output === "CandidatePatch") {
      await artifacts.writeText(output, buildCandidatePatch());
    } else if (output === "VerifierReport") {
      await artifacts.writeText(
        output,
        [
          "# Verifier Report",
          "",
          "Verdict: PASS",
          "",
          "Tests run:",
          "- git apply --check candidate.patch",
          "",
          "Verification evidence:",
          "- Candidate patch is checked by executable gates before transition."
        ].join("\n")
      );
    } else if (output === "FinalPatch") {
      const candidate = await artifacts.readText("CandidatePatch");
      await artifacts.writeText(output, candidate);
    } else if (output === "PRSummary") {
      await artifacts.writeText(
        output,
        [
          "# PR Summary",
          "",
          "## Summary",
          "Updates the target message fixture through the verified candidate patch.",
          "",
          "## Files changed",
          "- src/message.txt",
          "",
          "## Tests run",
          "- git apply --check candidate.patch",
          "",
          "## Verification evidence",
          "- Verifier report contains Verdict: PASS.",
          "- final.patch matches candidate.patch.",
          "",
          "## Residual risk",
          "- MVP uses deterministic role stubs rather than coding agents."
        ].join("\n")
      );
    } else {
      await artifacts.writeText(output, `Generated by ${stage.role}.\n`);
    }
    created.push(output);
  }

  return created;
}

async function failRun(
  logger: TraceLogger,
  result: Omit<RuntimeResult, "status">,
  error: string
): Promise<RuntimeResult> {
  await logger.emit("run_failed", { message: error });
  return {
    ...result,
    status: "FAIL",
    error
  };
}

export async function runHarness(
  harnessPath: string,
  repoPath: string,
  taskPath: string,
  runId?: string
): Promise<RuntimeResult> {
  runId ??= crypto.randomUUID();
  const resolvedHarnessPath = path.resolve(harnessPath);
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedTaskPath = path.resolve(taskPath);
  const spec = await loadHarness(resolvedHarnessPath);
  const compiled = await compileHarness(spec);

  const runRoot = path.resolve("runs", runId);
  const stateRoot = path.join(runRoot, "state");
  const artifactRoot = path.join(runRoot, "artifacts");
  const tracePath = path.join(stateRoot, "task_history.jsonl");
  await mkdir(stateRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await copyFile(resolvedTaskPath, path.join(runRoot, "TASK.md"));

  const artifacts = new ArtifactManager(runRoot, spec);
  const logger = new TraceLogger(tracePath, runId);
  const startState = Object.keys(compiled.stagesByFromState).find((candidate) =>
    !Object.values(spec.stages).some((stage) => stage.to === candidate)
  );
  if (!startState) {
    throw new NlahError("compiled harness has no start state");
  }

  const state: RuntimeState = {
    runId,
    currentState: startState,
    taskPath: resolvedTaskPath,
    repoPath: resolvedRepoPath,
    harnessPath: resolvedHarnessPath,
    stateRoot,
    artifactRoot,
    stageHistory: [],
    artifacts: {}
  };

  const baseResult = {
    runId,
    state: state.currentState,
    runRoot,
    artifacts: Object.keys(spec.artifacts),
    tracePath
  };

  await logger.emit("run_started", { fromState: state.currentState });

  try {
    while (true) {
      const enabled = compiled.stagesByFromState[state.currentState] ?? [];
      if (enabled.length === 0) {
        await logger.emit("run_completed", { toState: state.currentState });
        return {
          ...baseResult,
          status: "PASS",
          state: state.currentState
        };
      }
      if (enabled.length > 1) {
        return failRun(logger, { ...baseResult, state: state.currentState }, "branching execution is not implemented in MVP");
      }

      const stage = enabled[0];
      const stageName = compiled.stageOrder.find((name) => spec.stages[name] === stage);
      if (!stageName) {
        return failRun(logger, { ...baseResult, state: state.currentState }, "stage missing from compiled order");
      }

      await logger.emit("stage_started", {
        stage: stageName,
        fromState: stage.from,
        toState: stage.to
      });
      const rolePolicy = await loadRolePolicy(resolvedHarnessPath, stage.role);
      const created = await executeRoleStub(stage, state, artifacts, rolePolicy);

      for (const artifactName of created) {
        const status = await artifacts.status(artifactName);
        state.artifacts[artifactName] = status;
        await logger.emit("artifact_created", { stage: stageName, artifact: artifactName });
      }

      for (const output of stage.outputs) {
        const status = await artifacts.status(output);
        if (!status.exists || (status.sizeBytes ?? 0) === 0) {
          return failRun(
            logger,
            { ...baseResult, state: state.currentState },
            `missing required output artifact: ${output}`
          );
        }
      }

      const gateResults = await evaluateGateSpec(stage.gate, state, artifacts);
      for (const result of gateResults) {
        await logger.emit(result.passed ? "gate_passed" : "gate_failed", {
          stage: stageName,
          gate: result.gate,
          passed: result.passed,
          message: result.message
        });
      }
      const failedGate = gateResults.find((result) => !result.passed);
      if (failedGate) {
        return failRun(
          logger,
          { ...baseResult, state: state.currentState },
          `gate failed: ${failedGate.gate}: ${failedGate.message ?? ""}`.trim()
        );
      }

      const previousState = state.currentState;
      state.currentState = stage.to;
      await logger.emit("state_transition", {
        stage: stageName,
        fromState: previousState,
        toState: state.currentState
      });
      await logger.emit("stage_completed", {
        stage: stageName,
        fromState: previousState,
        toState: state.currentState
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failRun(logger, { ...baseResult, state: state.currentState }, message);
  }
}
