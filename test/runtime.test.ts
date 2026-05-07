import { describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runHarness } from "../src/runtime";

describe("runtime", () => {
  it("executes the MVP harness to PASS", async () => {
    const runId = `test-${Date.now()}`;
    const result = await runHarness(
      "harnesses/coding_swarm.mvp.yaml",
      "examples/target_repo_stub",
      "examples/TASK.md",
      runId
    );

    expect(result.status).toBe("PASS");
    expect(result.state).toBe("PullRequestReady");

    for (const artifact of [
      "issue_contract.md",
      "repo_map.md",
      "candidate.patch",
      "verifier_report.md",
      "final.patch",
      "pr_summary.md"
    ]) {
      await expect(stat(path.join(result.runRoot, "artifacts", artifact))).resolves.toBeTruthy();
    }

    const trace = await readFile(result.tracePath, "utf8");
    expect(trace).toContain("run_completed");
    expect(trace).toContain("gate_passed");
  });
});
