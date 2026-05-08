import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts.js";
import { CommandWorkerAdapter } from "../src/command_worker.js";
import { RuntimeError } from "../src/errors.js";
import type { RuntimeState } from "../src/state.js";
import type { WorkerInput } from "../src/workers.js";
import { tempDir, validSpec } from "./helpers.js";

async function fixture(): Promise<{
  artifacts: ArtifactManager;
  input: WorkerInput;
}> {
  const root = await tempDir("nlah-command-worker-");
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "command-worker-test",
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
        roleText: "Map repository",
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

describe("CommandWorkerAdapter", () => {
  it("calls handler for matching stageName", async () => {
    const { artifacts, input } = await fixture();
    const calls: string[] = [];
    const worker = new CommandWorkerAdapter({
      MAP: async (workerInput) => {
        calls.push(workerInput.stageName);
        return { createdArtifacts: [] };
      }
    });

    await worker.execute(input, artifacts);

    expect(calls).toEqual(["MAP"]);
  });

  it("handler can read input.context.taskText", async () => {
    const { artifacts, input } = await fixture();
    const worker = new CommandWorkerAdapter({
      MAP: async (workerInput) => ({
        createdArtifacts: [],
        message: workerInput.context.taskText
      })
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "Fix add()" });
  });

  it("handler can read input.context.inputArtifacts", async () => {
    const { artifacts, input } = await fixture();
    const worker = new CommandWorkerAdapter({
      MAP: async (workerInput) => ({
        createdArtifacts: [],
        message: workerInput.context.inputArtifacts.IssueContract ?? ""
      })
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "Issue contract text" });
  });

  it("handler can write declared output artifacts", async () => {
    const { artifacts, input } = await fixture();
    const worker = new CommandWorkerAdapter({
      MAP: async (workerInput, artifactManager) => {
        await artifactManager.writeText(workerInput.declaredOutputs[0]!, "repo map");
        return { createdArtifacts: [workerInput.declaredOutputs[0]!] };
      }
    });

    const result = await worker.execute(input, artifacts);

    expect(result.createdArtifacts).toEqual(["RepoMap"]);
    await expect(artifacts.readText("RepoMap")).resolves.toBe("repo map");
  });

  it("missing handler throws RuntimeError", async () => {
    const { artifacts, input } = await fixture();
    const worker = new CommandWorkerAdapter({});

    await expect(worker.execute(input, artifacts)).rejects.toThrow(RuntimeError);
  });

  it("createdArtifacts returned by handler are preserved", async () => {
    const { artifacts, input } = await fixture();
    const worker = new CommandWorkerAdapter({
      MAP: async () => ({ createdArtifacts: ["RepoMap"], message: "done" })
    });

    await expect(worker.execute(input, artifacts)).resolves.toEqual({
      createdArtifacts: ["RepoMap"],
      message: "done"
    });
  });
});
