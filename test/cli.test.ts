import { describe, expect, it } from "vitest";
import { formatRunResultJson, formatRunResultText } from "../src/cli.js";
import type { RuntimeResult } from "../src/state.js";

function resultFixture(overrides: Partial<RuntimeResult> = {}): RuntimeResult {
  return {
    runId: "cli-test",
    status: "PASS",
    finalState: "PullRequestReady",
    runRoot: "/tmp/nlah/runs/cli-test",
    artifactRoot: "/tmp/nlah/runs/cli-test/artifacts",
    tracePath: "/tmp/nlah/runs/cli-test/state/task_history.jsonl",
    summaryPath: "/tmp/nlah/runs/cli-test/summary.json",
    ...overrides
  };
}

describe("cli formatters", () => {
  it("text formatter includes the summary path", () => {
    const output = formatRunResultText(resultFixture());

    expect(output).toContain("Run ID: cli-test");
    expect(output).toContain("Status: PASS");
    expect(output).toContain("State: PullRequestReady");
    expect(output).toContain("Artifacts: /tmp/nlah/runs/cli-test/artifacts");
    expect(output).toContain("Trace: /tmp/nlah/runs/cli-test/state/task_history.jsonl");
    expect(output).toContain("Summary: /tmp/nlah/runs/cli-test/summary.json");
  });

  it("text formatter includes failure messages", () => {
    const output = formatRunResultText(resultFixture({ status: "FAIL", message: "gate failed" }));

    expect(output).toContain("Message: gate failed");
  });

  it("json formatter parses back to the same status, finalState, and summaryPath", () => {
    const result = resultFixture({ status: "INCOMPLETE", finalState: "PatchCandidate" });
    const parsed = JSON.parse(formatRunResultJson(result)) as RuntimeResult;

    expect(parsed.status).toBe(result.status);
    expect(parsed.finalState).toBe(result.finalState);
    expect(parsed.summaryPath).toBe(result.summaryPath);
  });
});
