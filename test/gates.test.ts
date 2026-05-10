import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts.js";
import { GateError } from "../src/errors.js";
import { evaluateGateSpec, gateRegistry, parseGateExpression } from "../src/gates.js";
import type { RuntimeState } from "../src/state.js";
import { createTargetRepo, tempDir, validSpec } from "./helpers.js";

async function fixture(): Promise<{ artifacts: ArtifactManager; state: RuntimeState }> {
  const root = await tempDir("nlah-gates-");
  const repo = await createTargetRepo(root);
  const artifacts = new ArtifactManager(root, validSpec());
  return {
    artifacts,
    state: {
      runId: "test",
      currentState: "TaskReceived",
      taskPath: path.join(root, "TASK.md"),
      repoPath: repo,
      harnessPath: path.resolve("harnesses/crew.mvp.yaml"),
      runRoot: root,
      stateRoot: path.join(root, "state"),
      artifactRoot: path.join(root, "artifacts"),
      stageHistory: [],
      artifacts: {}
    }
  };
}

describe("gates", () => {
  it("parses string gate", () => {
    expect(parseGateExpression("verifier_accepts_patch")).toEqual({
      gateName: "verifier_accepts_patch",
      args: undefined
    });
  });

  it("parses object gate", () => {
    expect(parseGateExpression({ exists: "RepoMap" })).toEqual({ gateName: "exists", args: "RepoMap" });
  });

  it("malformed object gate fails", () => {
    expect(() => parseGateExpression({ exists: "RepoMap", other: true })).toThrow(GateError);
  });

  it("exists passes for non-empty artifact", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("RepoMap", "content");
    await expect(gateRegistry.exists!(state, artifacts, "RepoMap")).resolves.toMatchObject({ passed: true });
  });

  it("exists fails for missing artifact", async () => {
    const { artifacts, state } = await fixture();
    await expect(gateRegistry.exists!(state, artifacts, "RepoMap")).resolves.toMatchObject({ passed: false });
  });

  it("verifier_accepts_patch passes only with Verdict: PASS", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("VerifierReport", "Verdict: FAIL\nTests run\n");
    await expect(gateRegistry.verifier_accepts_patch!(state, artifacts, undefined)).resolves.toMatchObject({ passed: false });
    await artifacts.writeText("VerifierReport", "Verdict: PASS\nTests run\n");
    await expect(gateRegistry.verifier_accepts_patch!(state, artifacts, undefined)).resolves.toMatchObject({ passed: true });
  });

  it("final_patch_matches_verified_candidate compares content", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("CandidatePatch", "same\n");
    await artifacts.writeText("FinalPatch", "same");
    await expect(gateRegistry.final_patch_matches_verified_candidate!(state, artifacts, undefined)).resolves.toMatchObject({
      passed: true
    });
  });

  it("any gate passes when at least one expression passes", async () => {
    const { artifacts, state } = await fixture();
    await artifacts.writeText("RepoMap", "content");

    await expect(
      evaluateGateSpec(
        {
          any: [{ exists: "CandidatePatch" }, { exists: "RepoMap" }]
        },
        state,
        artifacts
      )
    ).resolves.toMatchObject([
      {
        passed: true,
        gate: "any",
        message: "any-gate passed: exists",
        uses: "any",
        reads: ["CandidatePatch", "RepoMap"],
        memberResults: [{ passed: false }, { passed: true }]
      }
    ]);
  });

  it("any gate fails only when no expression passes", async () => {
    const { artifacts, state } = await fixture();

    await expect(
      evaluateGateSpec(
        {
          any: [{ exists: "CandidatePatch" }, { exists: "RepoMap" }]
        },
        state,
        artifacts
      )
    ).resolves.toMatchObject([
      {
        passed: false,
        gate: "any",
        message: "no any-gate passed: exists, exists",
        uses: "any",
        reads: ["CandidatePatch", "RepoMap"],
        memberResults: [{ passed: false }, { passed: false }]
      }
    ]);
  });
});
