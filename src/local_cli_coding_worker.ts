import path from "node:path";
import type { ArtifactManager } from "./artifacts.js";
import { ShellAdapter } from "./adapters.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type LocalCliCodingWorkerCommand = {
  command: string[];
  cwd?: string;
  timeoutSeconds?: number;
};

export type LocalCliCodingWorkerCommandFactory = (
  input: WorkerInput,
  artifacts: ArtifactManager
) => LocalCliCodingWorkerCommand;

export class LocalCliCodingWorkerAdapter implements WorkerAdapter {
  constructor(
    private readonly commands: Record<string, LocalCliCodingWorkerCommand | LocalCliCodingWorkerCommandFactory>,
    private readonly shell = new ShellAdapter()
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const entry = this.commands[input.stageName];

    if (!entry) {
      throw new RuntimeError(`no local CLI coding worker command for stage: ${input.stageName}`);
    }

    const spec = typeof entry === "function" ? entry(input, artifacts) : entry;

    if (!Array.isArray(spec.command) || spec.command.length === 0) {
      throw new RuntimeError(`invalid local CLI coding worker command for stage: ${input.stageName}`);
    }

    const cwd = path.resolve(spec.cwd ?? input.state.repoPath);
    const result = await this.shell.run(spec.command, cwd, spec.timeoutSeconds ?? 120);

    if (!result.ok) {
      throw new RuntimeError(
        [
          `local CLI coding worker command failed for stage: ${input.stageName}`,
          `command: ${spec.command.join(" ")}`,
          `exit: ${result.returncode}`,
          result.stderr ? `stderr: ${result.stderr}` : "",
          result.stdout ? `stdout: ${result.stdout}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    return {
      createdArtifacts: input.declaredOutputs,
      message: result.stdout
    };
  }
}
