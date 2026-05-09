import { describe, expect, it } from "vitest";
import type { AdapterResult } from "../src/adapters.js";
import { checkAiderAvailable } from "../src/aider_preflight.js";

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

describe("checkAiderAvailable", () => {
  it("returns ok true when fake shell reports aider is available", async () => {
    const shell = new FakeShell({
      ok: true,
      returncode: 0,
      stdout: "aider 1.2.3",
      stderr: ""
    });

    const result = await checkAiderAvailable({ shell, cwd: "/tmp/repo" });

    expect(result).toEqual({
      ok: true,
      command: "aider",
      message: "aider 1.2.3"
    });
    expect(shell.calls).toEqual([
      {
        command: ["aider", "--version"],
        cwd: "/tmp/repo",
        timeoutSeconds: 30
      }
    ]);
  });

  it("returns ok false when fake shell reports aider is unavailable", async () => {
    const shell = new FakeShell({
      ok: false,
      returncode: 127,
      stdout: "",
      stderr: "command not found: aider"
    });

    const result = await checkAiderAvailable({ command: "aider", shell, cwd: "/tmp/repo" });

    expect(result).toEqual({
      ok: false,
      command: "aider",
      message: "command not found: aider"
    });
    expect(shell.calls[0]?.command).toEqual(["aider", "--version"]);
  });
});
