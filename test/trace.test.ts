import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TraceLogger } from "../src/trace";
import { tempDir } from "./helpers";

describe("TraceLogger", () => {
  it("writes JSONL events with timestamp and runId", async () => {
    const root = await tempDir("nlah-trace-");
    const ledger = path.join(root, "state", "task_history.jsonl");
    const logger = new TraceLogger(ledger, "run-1");
    await logger.emit("state_transition", {
      fromState: "A",
      toState: "B"
    });

    const lines = (await readFile(ledger, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event.timestamp).toBeTypeOf("string");
    expect(event.runId).toBe("run-1");
    expect(event.fromState).toBe("A");
    expect(event.toState).toBe("B");
  });
});
