import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler";
import { detectCycles, traverseForward } from "../src/graph";
import { validSpec } from "./helpers";

describe("compiler", () => {
  it("compiles the stage graph", async () => {
    const compiled = await compileHarness(validSpec());
    expect(compiled.stagesByFromState.TaskReceived).toHaveLength(1);
  });

  it("produces deterministic stage order", async () => {
    const compiled = await compileHarness(validSpec());
    expect(compiled.stageOrder).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
  });

  it("fails unreachable stages", async () => {
    const spec = validSpec();
    spec.stages.ORPHAN = {
      from: "OtherStart",
      to: "OtherEnd",
      role: "Cartographer",
      inputs: [],
      outputs: ["RepoMap"]
    };
    await expect(compileHarness(spec)).rejects.toThrow(/multiple start states|unreachable/);
  });

  it("fails missing start state caused by cycle", async () => {
    const spec = validSpec();
    spec.stages.CONTRACT.from = "PullRequestReady";
    await expect(compileHarness(spec)).rejects.toThrow(/missing start state|cycles/);
  });

  it("fails graph cycles without loop semantics", async () => {
    const spec = validSpec();
    spec.stages.RELEASE.to = "RepoMapped";
    await expect(compileHarness(spec)).rejects.toThrow(/cycles/);
  });

  it("supports forward traversal and cycle detection", () => {
    const edges = [
      { stage: "A", from: "S1", to: "S2" },
      { stage: "B", from: "S2", to: "S3" }
    ];
    expect(traverseForward(edges, "S1").map((edge) => edge.stage)).toEqual(["A", "B"]);
    expect(detectCycles(edges)).toEqual([]);
  });
});
