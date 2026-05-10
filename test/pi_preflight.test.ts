import { describe, expect, it } from "vitest";
import type { AdapterResult } from "../src/adapters.js";
import { checkPiAvailable } from "../src/pi_preflight.js";

type ShellCall = {
  command: string[];
  cwd: string;
  timeoutSeconds?: number;
};

class FakeShell {
  readonly calls: ShellCall[] = [];

  constructor(private readonly result: AdapterResult) {}

  async run(command: string[], cwd: string, timeoutSeconds?: number): Promise<AdapterResult> {
    this.calls.push({
      command,
      cwd,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds })
    });
    return this.result;
  }
}

describe("checkPiAvailable", () => {
  it("returns ok true when fake shell reports pi is available", async () => {
    const shell = new FakeShell({
      ok: true,
      returncode: 0,
      stdout: "pi 1.2.3",
      stderr: ""
    });

    const result = await checkPiAvailable({ shell, cwd: "/tmp/repo" });

    expect(result).toEqual({
      ok: true,
      command: "pi",
      message: "pi 1.2.3"
    });
    expect(shell.calls).toEqual([
      {
        command: ["pi", "--version"],
        cwd: "/tmp/repo",
        timeoutSeconds: 30
      }
    ]);
  });

  it("returns ok false when fake shell reports pi is unavailable", async () => {
    const shell = new FakeShell({
      ok: false,
      returncode: 127,
      stdout: "",
      stderr: "command not found: pi"
    });

    const result = await checkPiAvailable({ command: "pi", shell, cwd: "/tmp/repo" });

    expect(result).toEqual({
      ok: false,
      command: "pi",
      message: "command not found: pi"
    });
    expect(shell.calls[0]?.command).toEqual(["pi", "--version"]);
  });
});
