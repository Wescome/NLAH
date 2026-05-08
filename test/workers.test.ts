import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts.js";
import type { StageContext } from "../src/context.js";
import type { RuntimeState } from "../src/state.js";
import { DeterministicWorkerAdapter } from "../src/workers.js";
import { createTargetRepo, tempDir, validSpec } from "./helpers.js";

async function workerFixture(): Promise<{
  artifacts: ArtifactManager;
  context: StageContext;
  state: RuntimeState;
}> {
  const root = await tempDir("nlah-workers-");
  const repo = await createTargetRepo(root);
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "worker-test",
    currentState: "PatchCandidate",
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
    context: {
      taskText: "Task body",
      inputArtifacts: {},
      outputArtifactPaths: {}
    },
    state
  };
}

describe("workers", () => {
  it("deterministic worker creates declared artifacts", async () => {
    const { artifacts, context, state } = await workerFixture();
    const worker = new DeterministicWorkerAdapter();

    const output = await worker.execute(
      {
        stageName: "VERIFY",
        roleName: "Verifier",
        context,
        state,
        declaredInputs: ["CandidatePatch"],
        declaredOutputs: ["VerifierReport"]
      },
      artifacts
    );

    expect(output.createdArtifacts).toEqual(["VerifierReport"]);
    await expect(artifacts.readText("VerifierReport")).resolves.toContain("Verdict: PASS");
  });

  it("deterministic worker preserves final patch equality", async () => {
    const { artifacts, context, state } = await workerFixture();
    const worker = new DeterministicWorkerAdapter();

    await worker.execute(
      {
        stageName: "PATCH",
        roleName: "PatchWorker",
        context,
        state,
        declaredInputs: [],
        declaredOutputs: ["CandidatePatch"]
      },
      artifacts
    );
    const output = await worker.execute(
      {
        stageName: "RELEASE",
        roleName: "ReleaseAgent",
        context,
        state,
        declaredInputs: ["CandidatePatch"],
        declaredOutputs: ["FinalPatch", "PRSummary"]
      },
      artifacts
    );

    expect(output.createdArtifacts).toEqual(["FinalPatch", "PRSummary"]);
    await expect(artifacts.readText("FinalPatch")).resolves.toBe(await artifacts.readText("CandidatePatch"));
  });
});
