import type { ArtifactManager } from "./artifacts.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type LlmWorkerRequest = {
  stageName: string;
  roleName: string;
  taskText: string;
  roleText?: string;
  inputArtifacts: Record<string, string>;
  outputArtifactPaths: Record<string, string>;
  declaredOutputs: string[];
};

export type LlmWorkerResponse = {
  artifacts: Record<string, string>;
  message?: string;
};

export interface LlmProvider {
  complete(request: LlmWorkerRequest): Promise<LlmWorkerResponse>;
}

export class LlmWorkerAdapter implements WorkerAdapter {
  constructor(private readonly provider: LlmProvider) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const request: LlmWorkerRequest = {
      stageName: input.stageName,
      roleName: input.roleName,
      taskText: input.context.taskText,
      ...(input.context.roleText === undefined ? {} : { roleText: input.context.roleText }),
      inputArtifacts: input.context.inputArtifacts,
      outputArtifactPaths: input.context.outputArtifactPaths,
      declaredOutputs: input.declaredOutputs
    };
    const response = await this.provider.complete(request);
    const createdArtifacts = Object.keys(response.artifacts);

    for (const artifact of createdArtifacts) {
      await artifacts.writeText(artifact, response.artifacts[artifact] ?? "");
    }

    return {
      createdArtifacts,
      ...(response.message === undefined ? {} : { message: response.message })
    };
  }
}
