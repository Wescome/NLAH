import { describe, expect, it } from "vitest";
import type { AdapterResult } from "../src/adapters.js";

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
