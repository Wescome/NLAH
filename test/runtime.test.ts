import { describe, expect, it } from "vitest";
import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runHarness } from "../src/runtime.js";
import { createTargetRepo, tempDir } from "./helpers.js";

describe("runtime", () => {
  it("executes the MVP harness to PASS with required files and trace events", async () => {
    const root = await tempDir("nlah-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const result = await runHarness(
        path.join(cwd, "harnesses/coding_swarm.mvp.yaml"),
        repo,
        taskPath,
        "runtime-test"
      );

      expect(result.status).toBe("PASS");
      expect(result.finalState).toBe("PullRequestReady");
      await expect(stat(path.join(result.runRoot, "TASK.md"))).resolves.toBeTruthy();

      for (const artifact of [
        "issue_contract.md",
        "repo_map.md",
        "candidate.patch",
        "verifier_report.md",
        "final.patch",
        "pr_summary.md"
      ]) {
        await expect(stat(path.join(result.artifactRoot, artifact))).resolves.toBeTruthy();
      }

      const trace = await readFile(result.tracePath, "utf8");
      for (const event of [
        "run_started",
        "stage_started",
        "artifact_created",
        "gate_passed",
        "state_transition",
        "stage_completed",
        "run_completed"
      ]) {
        expect(trace).toContain(event);
      }
    } finally {
      process.chdir(cwd);
    }
  });
});
