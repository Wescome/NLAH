import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FsArtifactManager, type ArtifactManager } from "../src/artifacts.js";
import { RuntimeError } from "../src/errors.js";
import { LocalCliCodingWorkerAdapter } from "../src/local_cli_coding_worker.js";
import type { RuntimeState } from "../src/state.js";
import type { WorkerInput } from "../src/workers.js";
import { tempDir, validSpec } from "./helpers.js";

async function fixture(): Promise<{
  artifacts: ArtifactManager;
  input: WorkerInput;
  root: string;
}> {
  const root = await tempDir("nlah-local-cli-coding-worker-");
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  const artifacts = new FsArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "local-cli-coding-worker-test",
    currentState: "IssueContracted",
    taskPath: path.join(root, "TASK.md"),
    repoPath: repo,
    harnessPath: path.resolve("harnesses/crew.mvp.yaml"),
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
    },
    root
  };
}

describe("LocalCliCodingWorkerAdapter", () => {
  it("executes a static command", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: { command: ["node", "--eval", "console.log('static local cli command')"] }
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({
      createdArtifacts: ["RepoMap"],
      message: "static local cli command"
    });
  });

  it("executes a command factory", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: () => ({ command: ["node", "--eval", "console.log('factory local cli command')"] })
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "factory local cli command" });
  });

  it("command factory can access input.context.taskText", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: (workerInput) => ({
        command: ["node", "--eval", `console.log(${JSON.stringify(workerInput.context.taskText)})`]
      })
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "Fix add()" });
  });

  it("command factory can access input.context.inputArtifacts", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: (workerInput) => ({
        command: ["node", "--eval", `console.log(${JSON.stringify(workerInput.context.inputArtifacts.IssueContract)})`]
      })
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "Issue contract text" });
  });

  it("command factory can write to input.context.outputArtifactPaths", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: (workerInput) => ({
        command: [
          "node",
          "--eval",
          [
            "const fs = require('fs');",
            "const path = require('path');",
            `const artifactPath = ${JSON.stringify(workerInput.context.outputArtifactPaths.RepoMap)};`,
            "fs.mkdirSync(path.dirname(artifactPath), { recursive: true });",
            "fs.writeFileSync(artifactPath, 'repo map');"
          ].join(" ")
        ]
      })
    });

    await worker.execute(input, artifacts);

    await expect(readFile(artifacts.resolve("RepoMap"), "utf8")).resolves.toBe("repo map");
  });

  it("default cwd is repoPath", async () => {
    const { artifacts, input } = await fixture();
    await writeFile(path.join(input.state.repoPath, "cwd.txt"), "from repo", "utf8");
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: { command: ["node", "--eval", "const fs=require('fs'); console.log(fs.readFileSync('cwd.txt','utf8'))"] }
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "from repo" });
  });

  it("failed command throws RuntimeError", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: { command: ["node", "--eval", "console.error('failed'); process.exit(2)"] }
    });

    await expect(worker.execute(input, artifacts)).rejects.toThrow(RuntimeError);
  });

  it("missing command throws RuntimeError", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({});

    await expect(worker.execute(input, artifacts)).rejects.toThrow(RuntimeError);
  });

  it("createdArtifacts equals declaredOutputs", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: { command: ["node", "--eval", "console.log('ok')"] }
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({
      createdArtifacts: input.declaredOutputs
    });
  });

  it("message includes stdout", async () => {
    const { artifacts, input } = await fixture();
    const worker = new LocalCliCodingWorkerAdapter({
      MAP: { command: ["node", "--eval", "console.log('local cli stdout')"] }
    });

    await expect(worker.execute(input, artifacts)).resolves.toMatchObject({ message: "local cli stdout" });
  });
});
