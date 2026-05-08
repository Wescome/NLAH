import { describe, expect, it } from "vitest";
import {
  assertNoCycles,
  assertReachableFrom,
  buildStageGraph,
  deterministicStageOrder,
  findStartStates
} from "../src/graph.js";
import { CompilerError } from "../src/errors.js";
import { validSpec } from "./helpers.js";

describe("stage graph", () => {
  it("simple linear graph builds", () => {
    const graph = buildStageGraph(validSpec().stages);
    expect(graph.edges).toHaveLength(5);
    expect(graph.states.has("TaskReceived")).toBe(true);
  });

  it("start state is detected", () => {
    expect(findStartStates(buildStageGraph(validSpec().stages))).toEqual(["TaskReceived"]);
  });

  it("deterministic order is stable", () => {
    expect(deterministicStageOrder(validSpec().stages, "TaskReceived")).toEqual([
      "CONTRACT",
      "MAP",
      "PATCH",
      "VERIFY",
      "RELEASE"
    ]);
  });

  it("cycle throws CompilerError", () => {
    const spec = validSpec();
    spec.stages.RELEASE!.to = "RepoMapped";
    expect(() => assertNoCycles(buildStageGraph(spec.stages))).toThrow(CompilerError);
  });

  it("unreachable stage throws CompilerError", () => {
    const spec = validSpec();
    spec.stages.ORPHAN = {
      from: "OtherStart",
      to: "OtherEnd",
      role: "Cartographer",
      inputs: [],
      outputs: ["RepoMap"]
    };
    expect(() => assertReachableFrom(buildStageGraph(spec.stages), "TaskReceived")).toThrow(CompilerError);
  });
});
