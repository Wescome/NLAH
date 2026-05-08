import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactManager } from "../src/artifacts.js";
import { runHarness } from "../src/runtime.js";
import { ScriptWorkerAdapter, type ScriptWorkerCommand } from "../src/script_worker.js";
import type { WorkerInput } from "../src/workers.js";
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

function writeArtifactsCommand(input: WorkerInput, contentByArtifact: Record<string, string>): ScriptWorkerCommand {
  const files: Record<string, string> = {};

  for (const [artifact, content] of Object.entries(contentByArtifact)) {
    const outputPath = input.context.outputArtifactPaths[artifact];
    if (!outputPath) {
      throw new Error(`missing output path for artifact: ${artifact}`);
    }
    files[outputPath] = content;
  }

  return {
    command: [
      "node",
      "--eval",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `const files = ${JSON.stringify(files)};`,
        "for (const [file, content] of Object.entries(files)) {",
        "fs.mkdirSync(path.dirname(file), { recursive: true });",
        "fs.writeFileSync(file, content, 'utf8');",
        "}",
        "console.log(`wrote ${Object.keys(files).length} artifact(s)`);"
      ].join(" ")
    ]
  };
}

function releaseCommand(input: WorkerInput, artifacts: ArtifactManager): ScriptWorkerCommand {
  const finalPatchPath = input.context.outputArtifactPaths.FinalPatch;
  const prSummaryPath = input.context.outputArtifactPaths.PRSummary;
  if (!finalPatchPath) {
    throw new Error("missing output path for artifact: FinalPatch");
  }
  if (!prSummaryPath) {
    throw new Error("missing output path for artifact: PRSummary");
  }

  return {
    command: [
      "node",
      "--eval",
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `const candidatePatchPath = ${JSON.stringify(artifacts.resolve("CandidatePatch"))};`,
        `const finalPatchPath = ${JSON.stringify(finalPatchPath)};`,
        `const prSummaryPath = ${JSON.stringify(prSummaryPath)};`,
        `const prSummary = ${JSON.stringify(prSummary)};`,
        "fs.mkdirSync(path.dirname(finalPatchPath), { recursive: true });",
        "fs.writeFileSync(finalPatchPath, fs.readFileSync(candidatePatchPath, 'utf8'), 'utf8');",
        "fs.mkdirSync(path.dirname(prSummaryPath), { recursive: true });",
        "fs.writeFileSync(prSummaryPath, prSummary, 'utf8');",
        "console.log('wrote 2 artifact(s)');"
      ].join(" ")
    ]
  };
}

export function createMvpScriptWorkerAdapter(): ScriptWorkerAdapter {
  return new ScriptWorkerAdapter({
    CONTRACT: (input) => writeArtifactsCommand(input, { IssueContract: issueContract }),
    MAP: (input) => writeArtifactsCommand(input, { RepoMap: repoMap }),
    PATCH: (input) => writeArtifactsCommand(input, { CandidatePatch: candidatePatch }),
    VERIFY: (input) => writeArtifactsCommand(input, { VerifierReport: verifierReport }),
    RELEASE: releaseCommand
  });
}

export async function runScriptWorkerDemo(): Promise<void> {
  const scriptWorker = createMvpScriptWorkerAdapter();
  const workerRegistry = new WorkerRegistry({
    defaultWorker: "script",
    workers: { script: scriptWorker }
  });

  const result = await runHarness("harnesses/crew.mvp.yaml", "examples/target_repo_stub", "examples/TASK.md", {
    runId: "script-worker-demo",
    workerRegistry,
    overwriteRun: true
  });
  console.log(JSON.stringify(result, null, 2));
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  runScriptWorkerDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
