import { ShellAdapter, type AdapterResult } from "./adapters.js";

type ShellLike = {
  run(command: string[], cwd: string, timeoutSeconds?: number): Promise<AdapterResult>;
};

export type PiPreflightResult = {
  ok: boolean;
  command: string;
  message: string;
};

export async function checkPiAvailable(args: {
  command?: string;
  shell?: ShellLike;
  cwd?: string;
} = {}): Promise<PiPreflightResult> {
  const command = args.command ?? "pi";
  const shell = args.shell ?? new ShellAdapter();
  const cwd = args.cwd ?? process.cwd();

  try {
    const result = await shell.run([command, "--version"], cwd, 30);
    if (result.ok) {
      return {
        ok: true,
        command,
        message: result.stdout || "Pi is available"
      };
    }

    return {
      ok: false,
      command,
      message: result.stderr || result.stdout || "Pi is not available"
    };
  } catch (error) {
    return {
      ok: false,
      command,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
