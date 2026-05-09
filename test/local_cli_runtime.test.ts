import path from "node:path";
import { cp, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createMvpLocalCliWorkerAdapter } from "../examples/local_cli_demo.js";
import { runHarness } from "../src/runtime.js";
import { WorkerRegistry } from "../src/worker_registry.js";
import { createTargetRepo, tempDir } from "./helpers.js";

describe("local CLI worker runtime", () => {
  it("executes the crew harness through LocalCliCodingWorkerAdapter and WorkerRegistry", async () => {
    const root = await tempDir("nlah-local-cli-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    const localCliWorker = createMvpLocalCliWorkerAdapter();
    const workerRegistry = new WorkerRegistry({
      defaultWorker: "local-cli",
      workers: { "local-cli": localCliWorker }
    });

    process.chdir(root);
    try {
      const result = await runHarness(path.join(cwd, "harnesses/crew.mvp.yaml"), repo, taskPath, {
        runId: "local-cli-runtime-test",
        workerRegistry
      });

      expect(result.status).toBe("PASS");
      await expect(stat(result.summaryPath)).resolves.toBeTruthy();

      const finalPatchPath = path.join(result.artifactRoot, "final.patch");
      await expect(stat(finalPatchPath)).resolves.toBeTruthy();
      await expect(stat(path.join(result.artifactRoot, "pr_summary.md"))).resolves.toBeTruthy();

      const finalPatch = await readFile(finalPatchPath, "utf8");
      expect(finalPatch).toContain("return a + b;");

      const trace = await readFile(result.tracePath, "utf8");
      expect(trace).toContain("worker_completed");
      expect(trace).toContain("run_completed");
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});
