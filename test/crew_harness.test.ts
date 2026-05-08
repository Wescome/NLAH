import { describe, expect, it } from "vitest";
import path from "node:path";
import { compileHarness, loadHarness } from "../src/compiler.js";
import type { HarnessSpec } from "../src/schema.js";

const stageOrder = ["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"];

function expectStageContract(
  spec: HarnessSpec,
  stageName: string,
  inputs: string[],
  outputs: string[]
): void {
  const stage = spec.stages[stageName];
  expect(stage, `${stageName} must exist`).toBeDefined();
  expect(stage?.inputs).toEqual(inputs);
  expect(stage?.outputs).toEqual(outputs);
}

describe("crew MVP harness", () => {
  it("declares canonical crew metadata", async () => {
    const spec = await loadHarness(path.resolve("harnesses/crew.mvp.yaml"));

    expect(spec.harness.name).toBe("CREW_MVP");
    expect(spec.harness.task_family).toBe("repository_issue_resolution");
  });

  it("compiles to the canonical stage order", async () => {
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/crew.mvp.yaml")));

    expect(compiled.stageOrder).toEqual(stageOrder);
  });

  it("passes compiler dataflow validation", async () => {
    const spec = await loadHarness(path.resolve("harnesses/crew.mvp.yaml"));

    expect(() => compileHarness(spec)).not.toThrow();
  });

  it("declares exact stage input artifacts", async () => {
    const spec = await loadHarness(path.resolve("harnesses/crew.mvp.yaml"));

    expectStageContract(spec, "CONTRACT", [], ["IssueContract"]);
    expectStageContract(spec, "MAP", ["IssueContract"], ["RepoMap"]);
    expectStageContract(spec, "PATCH", ["IssueContract", "RepoMap"], ["CandidatePatch"]);
    expectStageContract(spec, "VERIFY", ["IssueContract", "RepoMap", "CandidatePatch"], ["VerifierReport"]);
    expectStageContract(
      spec,
      "RELEASE",
      ["IssueContract", "RepoMap", "CandidatePatch", "VerifierReport"],
      ["FinalPatch", "PRSummary"]
    );
  });

  it("legacy coding_swarm harness still compiles to the canonical stage order", async () => {
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/coding_swarm.mvp.yaml")));

    expect(compiled.stageOrder).toEqual(stageOrder);
  });
});
