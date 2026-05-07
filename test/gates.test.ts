import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts";
import { gateRegistry } from "../src/gates";
import type { RuntimeState } from "../src/state";
import { createTargetRepo, tempDir, validSpec } from "./helpers";

async function fixture() {
  const root = await tempDir("nlah-gates-");
  const repo = await createTargetRepo(root);
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "test",
    currentState: "TaskReceived",
    taskPath: path.join(root, "TASK.md"),
    repoPath: repo,
    harnessPath: path.resolve("harnesses/coding_swarm.mvp.yaml"),
    stateRoot: path.join(root, "state"),
    artifactRoot: path.join(root, "artifacts"),
    stageHistory: [],
    artifacts: {}
  };
  return { artifacts, state };
}

describe("gates", () => {
  it("exists passes when a file exists", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("RepoMap", "content");
    await expect(gateRegistry.exists(state, artifacts, "RepoMap")).resolves.toMatchObject({ passed: true });
  });

  it("exists fails when missing", async () => {
    const { artifacts, state } = await fixture();
    await expect(gateRegistry.exists(state, artifacts, "RepoMap")).resolves.toMatchObject({ passed: false });
  });

  it("verifier_accepts_patch passes only on Verdict: PASS", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("VerifierReport", "Verdict: FAIL\nTests run: none\n");
    await expect(gateRegistry.verifier_accepts_patch(state, artifacts, undefined)).resolves.toMatchObject({ passed: false });
    await artifacts.writeText("VerifierReport", "Verdict: PASS\nTests run: check\n");
    await expect(gateRegistry.verifier_accepts_patch(state, artifacts, undefined)).resolves.toMatchObject({ passed: true });
  });

  it("repo_map gate requires relevant files section", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("RepoMap", "## Relevant files\n- src/message.txt\n");
    await expect(gateRegistry.repo_map_names_relevant_files(state, artifacts, undefined)).resolves.toMatchObject({ passed: true });
    await artifacts.writeText("RepoMap", "## Something else\n- src/message.txt\n");
    await expect(gateRegistry.repo_map_names_relevant_files(state, artifacts, undefined)).resolves.toMatchObject({ passed: false });
  });

  it("repo_map gate requires test entrypoints section", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("RepoMap", "## Relevant tests\n- pnpm test\n");
    await expect(gateRegistry.repo_map_names_test_entrypoints(state, artifacts, undefined)).resolves.toMatchObject({ passed: true });
  });
});
