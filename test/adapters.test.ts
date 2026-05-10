import { describe, expect, it } from "vitest";
import { NodeSpawnAdapter, type AdapterResult } from "../src/adapters.js";

describe("AdapterResult", () => {
  it("accepts optional timeout, signal, and failed metadata", () => {
    const result: AdapterResult = {
      ok: false,
      returncode: 1,
      stdout: "",
      stderr: "terminated",
      timedOut: true,
      signal: "SIGTERM",
      failed: true
    };

    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGTERM");
    expect(result.failed).toBe(true);
  });
});

describe("NodeSpawnAdapter", () => {
  it("captures stdout from a spawned command", async () => {
    const adapter = new NodeSpawnAdapter();

    const result = await adapter.run(["node", "--eval", "console.log('spawn-ok')"], process.cwd());

    expect(result).toEqual({
      ok: true,
      returncode: 0,
      stdout: "spawn-ok\n",
      stderr: ""
    });
  });
});
