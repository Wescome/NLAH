import { describe, expect, it } from "vitest";
import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { FakeMvpLlmProvider } from "../examples/mock_llm_demo.js";
import { LlmWorkerAdapter } from "../src/llm_worker.js";
import { runHarness } from "../src/runtime.js";
import { WorkerRegistry } from "../src/worker_registry.js";
import { createTargetRepo, tempDir } from "./helpers.js";

describe("llm worker runtime", () => {
  it("executes the MVP harness through LlmWorkerAdapter and a fake provider", async () => {
    const root = await tempDir("nlah-llm-worker-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const provider = new FakeMvpLlmProvider();
    const workerRegistry = new WorkerRegistry({
      defaultWorker: "mock-llm",
      workers: { "mock-llm": new LlmWorkerAdapter(provider) }
    });
    const cwd = process.cwd();

    process.chdir(root);
    try {
      const result = await runHarness(path.join(cwd, "harnesses/coding_swarm.mvp.yaml"), repo, taskPath, {
        runId: "llm-worker-runtime-test",
        workerRegistry
      });

      expect(result.status).toBe("PASS");
      await expect(stat(path.join(result.artifactRoot, "final.patch"))).resolves.toBeTruthy();
      await expect(stat(path.join(result.artifactRoot, "pr_summary.md"))).resolves.toBeTruthy();
      await expect(stat(result.summaryPath)).resolves.toBeTruthy();

      const trace = await readFile(result.tracePath, "utf8");
      expect(trace).toContain("worker_completed");
      expect(trace).toContain("run_completed");

      const stages = provider.requests.map((request) => request.stageName);
      expect(stages).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);

      const mapRequest = provider.requests.find((request) => request.stageName === "MAP");
      expect(mapRequest?.inputArtifacts.IssueContract).toContain("# Issue Contract");

      const patchRequest = provider.requests.find((request) => request.stageName === "PATCH");
      expect(patchRequest?.inputArtifacts.IssueContract).toContain("# Issue Contract");
      expect(patchRequest?.inputArtifacts.RepoMap).toContain("# Repo Map");

      const verifyRequest = provider.requests.find((request) => request.stageName === "VERIFY");
      expect(verifyRequest?.inputArtifacts.CandidatePatch).toContain("return a + b;");

      const releaseRequest = provider.requests.find((request) => request.stageName === "RELEASE");
      expect(releaseRequest?.inputArtifacts.CandidatePatch).toContain("return a + b;");
      expect(releaseRequest?.inputArtifacts.VerifierReport).toContain("Verdict: PASS");
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});
