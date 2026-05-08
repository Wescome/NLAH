import type { ArtifactManager } from "./artifacts.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type CommandWorkerHandler = (
  input: WorkerInput,
  artifacts: ArtifactManager
) => Promise<WorkerOutput>;

export class CommandWorkerAdapter implements WorkerAdapter {
  constructor(private readonly handlers: Record<string, CommandWorkerHandler>) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const handler = this.handlers[input.stageName];

    if (!handler) {
      throw new RuntimeError(`no command worker handler for stage: ${input.stageName}`);
    }

    return handler(input, artifacts);
  }
}
