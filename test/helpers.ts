import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HarnessSpec } from "../src/schema";

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function validSpec(): HarnessSpec {
  return {
    nlahspec: "0.1",
    harness: {
      name: "TEST",
      task_family: "repository_issue_resolution",
      objective: "test"
    },
    runtime: {
      max_patch_workers: 1,
      max_repair_rounds: 0,
      state_root: "runs/current/state",
      artifact_root: "runs/current/artifacts"
    },
    roles: {
      Cartographer: { responsibility: "map" },
      PatchWorker: { responsibility: "patch" },
      Verifier: { responsibility: "verify" },
      ReleaseAgent: { responsibility: "release" }
    },
    artifacts: {
      IssueContract: { path: "artifacts/issue_contract.md", required: true },
      RepoMap: { path: "artifacts/repo_map.md", required: true },
      CandidatePatch: { path: "artifacts/candidate.patch", required: true },
      VerifierReport: { path: "artifacts/verifier_report.md", required: true },
      FinalPatch: { path: "artifacts/final.patch", required: true },
      PRSummary: { path: "artifacts/pr_summary.md", required: true }
    },
    stages: {
      CONTRACT: {
        from: "TaskReceived",
        to: "IssueContracted",
        role: "Cartographer",
        inputs: [],
        outputs: ["IssueContract"]
      },
      MAP: {
        from: "IssueContracted",
        to: "RepoMapped",
        role: "Cartographer",
        inputs: [],
        outputs: ["RepoMap"]
      },
      PATCH: {
        from: "RepoMapped",
        to: "PatchCandidate",
        role: "PatchWorker",
        inputs: [],
        outputs: ["CandidatePatch"]
      },
      VERIFY: {
        from: "PatchCandidate",
        to: "VerifiedPatch",
        role: "Verifier",
        inputs: [],
        outputs: ["VerifierReport"]
      },
      RELEASE: {
        from: "VerifiedPatch",
        to: "PullRequestReady",
        role: "ReleaseAgent",
        inputs: [],
        outputs: ["FinalPatch", "PRSummary"]
      }
    },
    failure_taxonomy: {}
  };
}

export async function createTargetRepo(root: string): Promise<string> {
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src", "message.txt"), "hello from nlah\n", "utf8");
  return repo;
}
