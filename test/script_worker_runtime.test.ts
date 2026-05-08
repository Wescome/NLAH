import { describe, expect, it } from "vitest";
import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createMvpScriptWorkerAdapter } from "../examples/script_worker_demo.js";
import { runHarness } from "../src/runtime.js";
import { WorkerRegistry } from "../src/worker_registry.js";
import { createTargetRepo, tempDir } from "./helpers.js";

describe("script worker runtime", () => {
  it("executes the MVP harness through ScriptWorkerAdapter and WorkerRegistry", async () => {
    const root = await tempDir("nlah-script-worker-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    const scriptWorker = createMvpScriptWorkerAdapter();
    const workerRegistry = new WorkerRegistry({
      defaultWorker: "script",
      workers: { script: scriptWorker }
    });

    process.chdir(root);
    try {
      const result = await runHarness(path.join(cwd, "harnesses/crew.mvp.yaml"), repo, taskPath, {
        runId: "script-worker-runtime-test",
        workerRegistry
      });

      expect(result.status).toBe("PASS");
      await expect(stat(result.summaryPath)).resolves.toBeTruthy();
      await expect(stat(path.join(result.artifactRoot, "final.patch"))).resolves.toBeTruthy();

      const trace = await readFile(result.tracePath, "utf8");
      expect(trace).toContain("worker_completed");
      expect(trace).toContain("run_completed");
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});
