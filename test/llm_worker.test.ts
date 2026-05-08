import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts.js";
import {
  LlmWorkerAdapter,
  type LlmProvider,
  type LlmWorkerRequest,
  type LlmWorkerResponse
} from "../src/llm_worker.js";
import type { RuntimeState } from "../src/state.js";
import type { WorkerInput } from "../src/workers.js";
import { tempDir, validSpec } from "./helpers.js";

class FakeLlmProvider implements LlmProvider {
  requests: LlmWorkerRequest[] = [];

  constructor(private readonly response: LlmWorkerResponse) {}

  async complete(request: LlmWorkerRequest): Promise<LlmWorkerResponse> {
    this.requests.push(request);
    return this.response;
  }
}

async function fixture(): Promise<{
  artifacts: ArtifactManager;
  input: WorkerInput;
}> {
  const root = await tempDir("nlah-llm-worker-");
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "llm-worker-test",
    currentState: "IssueContracted",
    taskPath: path.join(root, "TASK.md"),
    repoPath: root,
    harnessPath: path.resolve("harnesses/coding_swarm.mvp.yaml"),
    runRoot: root,
    stateRoot: path.join(root, "state"),
    artifactRoot: path.join(root, "artifacts"),
    stageHistory: [],
    artifacts: {}
  };

  return {
    artifacts,
    input: {
      stageName: "MAP",
      roleName: "Cartographer",
      context: {
        taskText: "Fix add()",
        roleText: "Map relevant files",
        inputArtifacts: {
          IssueContract: "Issue contract text"
        },
        outputArtifactPaths: {
          RepoMap: artifacts.resolve("RepoMap")
        }
      },
      state,
      declaredInputs: ["IssueContract"],
      declaredOutputs: ["RepoMap"]
    }
  };
}

describe("LlmWorkerAdapter", () => {
  it("builds request from WorkerInput context", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toEqual({
      stageName: "MAP",
      roleName: "Cartographer",
      taskText: "Fix add()",
      roleText: "Map relevant files",
      inputArtifacts: {
        IssueContract: "Issue contract text"
      },
      outputArtifactPaths: {
        RepoMap: artifacts.resolve("RepoMap")
      },
      declaredOutputs: ["RepoMap"]
    });
  });

  it("provider receives stageName and roleName", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.stageName).toBe("MAP");
    expect(provider.requests[0]?.roleName).toBe("Cartographer");
  });

  it("provider receives taskText", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.taskText).toBe("Fix add()");
  });

  it("provider receives roleText when present", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.roleText).toBe("Map relevant files");
  });

  it("provider receives inputArtifacts", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.inputArtifacts).toEqual({
      IssueContract: "Issue contract text"
    });
  });

  it("provider receives outputArtifactPaths", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.outputArtifactPaths).toEqual({
      RepoMap: artifacts.resolve("RepoMap")
    });
  });

  it("provider receives declaredOutputs", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    expect(provider.requests[0]?.declaredOutputs).toEqual(["RepoMap"]);
  });

  it("writes returned artifacts", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await worker.execute(input, artifacts);

    await expect(artifacts.readText("RepoMap")).resolves.toBe("repo map");
  });

  it("returns createdArtifacts", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { RepoMap: "repo map" } });
    const worker = new LlmWorkerAdapter(provider);

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({
      createdArtifacts: ["RepoMap"]
    });
  });

  it("preserves message", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({
      artifacts: { RepoMap: "repo map" },
      message: "provider completed"
    });
    const worker = new LlmWorkerAdapter(provider);

    await expect(worker.execute(input, artifacts)).resolves.toEqual({
      createdArtifacts: ["RepoMap"],
      message: "provider completed"
    });
  });

  it("does not reject undeclared artifacts", async () => {
    const { artifacts, input } = await fixture();
    const provider = new FakeLlmProvider({ artifacts: { PRSummary: "summary" } });
    const worker = new LlmWorkerAdapter(provider);

    const result = await worker.execute(input, artifacts);

    expect(result.createdArtifacts).toEqual(["PRSummary"]);
    await expect(artifacts.readText("PRSummary")).resolves.toBe("summary");
  });
});
