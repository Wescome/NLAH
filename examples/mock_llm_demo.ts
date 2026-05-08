import path from "node:path";
import { fileURLToPath } from "node:url";
import { LlmWorkerAdapter, type LlmProvider, type LlmWorkerRequest, type LlmWorkerResponse } from "../src/llm_worker.js";
import { runHarness } from "../src/runtime.js";
import { WorkerRegistry } from "../src/worker_registry.js";

const candidatePatch = [
  "diff --git a/src/math.ts b/src/math.ts",
  "index 0000000..0000001 100644",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -1,3 +1,3 @@",
  " export function add(a: number, b: number): number {",
  "-  return a - b;",
  "+  return a + b;",
  " }",
  ""
].join("\n");

const issueContract = [
  "# Issue Contract",
  "",
  "## Problem Summary",
  "",
  "Fix the target repository task described in TASK.md.",
  "",
  "## Acceptance Criteria",
  "",
  "The patch must satisfy the task and pass verification.",
  "",
  "## Non-Goals",
  "",
  "No unrelated refactors.",
  ""
].join("\n");

const repoMap = [
  "# Repo Map",
  "",
  "## Problem summary",
  "",
  "The target task concerns the repository behavior described in TASK.md.",
  "",
  "## Relevant files",
  "",
  "- src/math.ts",
  "",
  "## Relevant tests",
  "",
  "- test/math.test.ts",
  "",
  "## Suspected root cause",
  "",
  "Implementation does not satisfy expected behavior.",
  "",
  "## Blast-radius risks",
  "",
  "Keep patch minimal.",
  ""
].join("\n");

const verifierReport = [
  "# Verifier Report",
  "",
  "## Patch Summary",
  "",
  "The candidate patch changes add() to return the sum of its inputs.",
  "",
  "## Tests run",
  "",
  "- git apply --check candidate.patch",
  "",
  "## Evidence",
  "",
  "Patch applies cleanly.",
  "",
  "## Verdict",
  "",
  "Verdict: PASS",
  ""
].join("\n");

const prSummary = [
  "# PR Summary",
  "",
  "## Summary",
  "",
  "Fix add() so it returns a + b.",
  "",
  "## Files changed",
  "",
  "- src/math.ts",
  "",
  "## Tests run",
  "",
  "- git apply --check candidate.patch",
  "",
  "## Verification evidence",
  "",
  "Verifier report returned Verdict: PASS.",
  "",
  "## Residual risk",
  "",
  "Minimal; single-line arithmetic fix.",
  ""
].join("\n");

export class FakeMvpLlmProvider implements LlmProvider {
  readonly requests: LlmWorkerRequest[] = [];

  async complete(request: LlmWorkerRequest): Promise<LlmWorkerResponse> {
    this.requests.push(request);

    if (request.stageName === "CONTRACT") {
      return { artifacts: { IssueContract: issueContract }, message: "mock CONTRACT complete" };
    }

    if (request.stageName === "MAP") {
      return { artifacts: { RepoMap: repoMap }, message: "mock MAP complete" };
    }

    if (request.stageName === "PATCH") {
      return { artifacts: { CandidatePatch: candidatePatch }, message: "mock PATCH complete" };
    }

    if (request.stageName === "VERIFY") {
      return { artifacts: { VerifierReport: verifierReport }, message: "mock VERIFY complete" };
    }

    if (request.stageName === "RELEASE") {
      const finalPatch = request.inputArtifacts.CandidatePatch;
      if (!finalPatch) {
        throw new Error("CandidatePatch input artifact is required for RELEASE");
      }

      return {
        artifacts: {
          FinalPatch: finalPatch,
          PRSummary: prSummary
        },
        message: "mock RELEASE complete"
      };
    }

    return { artifacts: {}, message: `mock ignored stage ${request.stageName}` };
  }
}

export function createMvpMockLlmWorkerAdapter(): LlmWorkerAdapter {
  return new LlmWorkerAdapter(new FakeMvpLlmProvider());
}

export async function runMockLlmDemo(): Promise<void> {
  const workerRegistry = new WorkerRegistry({
    defaultWorker: "mock-llm",
    workers: { "mock-llm": createMvpMockLlmWorkerAdapter() }
  });

  const result = await runHarness("harnesses/coding_swarm.mvp.yaml", "examples/target_repo_stub", "examples/TASK.md", {
    runId: "mock-llm-demo",
    workerRegistry
  });
  console.log(JSON.stringify(result, null, 2));
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  runMockLlmDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
