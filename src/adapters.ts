import path from "node:path";
import { execa } from "execa";
import { RuntimeError } from "./errors.js";

export type AdapterResult = {
  ok: boolean;
  returncode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  signal?: string;
  failed?: boolean;
};

export type AdapterEnv = Record<string, string>;

export class ShellAdapter {
  constructor(private readonly allowedRoots: string[] = []) {}

  async run(command: string[], cwd: string, timeoutSeconds = 120, env?: AdapterEnv): Promise<AdapterResult> {
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) {
      throw new RuntimeError("command must be a non-empty string[]");
    }

    const resolvedCwd = path.resolve(cwd);
    if (this.allowedRoots.length > 0) {
      const allowed = this.allowedRoots.map((root) => path.resolve(root));
      const insideAllowedRoot = allowed.some(
        (root) => resolvedCwd === root || resolvedCwd.startsWith(`${root}${path.sep}`)
      );
      if (!insideAllowedRoot) {
        throw new RuntimeError(`working directory is outside allowed roots: ${cwd}`);
      }
    }

    try {
      const executable = command[0];
      if (!executable) {
        throw new RuntimeError("command must include an executable");
      }
      const result = await execa(executable, command.slice(1), {
        cwd: resolvedCwd,
        ...(env ? { env } : {}),
        timeout: timeoutSeconds * 1000,
        reject: false
      });
      return {
        ok: result.exitCode === 0,
        returncode: result.exitCode ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
        ...optionalAdapterMetadata(result)
      };
    } catch (error) {
      const errorWithMetadata = error as {
        exitCode?: unknown;
        stdout?: unknown;
        stderr?: unknown;
        message?: unknown;
        timedOut?: unknown;
        signal?: unknown;
      };
      const stderr = errorWithMetadata.stderr ?? errorWithMetadata.message ?? "";
      return {
        ok: false,
        returncode: typeof errorWithMetadata.exitCode === "number" ? errorWithMetadata.exitCode : 1,
        stdout: String(errorWithMetadata.stdout ?? ""),
        stderr: String(stderr),
        ...(Boolean(errorWithMetadata.timedOut) ? { timedOut: true } : {}),
        ...(typeof errorWithMetadata.signal === "string" ? { signal: errorWithMetadata.signal } : {}),
        failed: true
      };
    }
  }
}

function optionalAdapterMetadata(result: {
  timedOut?: unknown;
  signal?: unknown;
  failed?: unknown;
}): Pick<AdapterResult, "timedOut" | "signal" | "failed"> {
  return {
    ...(Boolean(result.timedOut) ? { timedOut: true } : {}),
    ...(typeof result.signal === "string" ? { signal: result.signal } : {}),
    ...(typeof result.failed === "boolean" ? { failed: result.failed } : {})
  };
}
