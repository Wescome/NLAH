import { describe, expect, it } from "vitest";
import path from "node:path";
import { compileHarness, loadHarness } from "../src/compiler.js";
import { CompilerError } from "../src/errors.js";
import { validSpec } from "./helpers.js";

describe("compiler", () => {
  it("valid harness compiles", async () => {
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/crew.mvp.yaml")));
    expect(compiled.startState).toBe("TaskReceived");
    expect(compiled.terminalStates).toEqual(["PullRequestReady"]);
  });

  it("legacy coding_swarm harness still compiles", async () => {
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/coding_swarm.mvp.yaml")));
    expect(compiled.startState).toBe("TaskReceived");
    expect(compiled.terminalStates).toEqual(["PullRequestReady"]);
  });

  it("missing role fails", () => {
    const spec = validSpec();
    spec.stages.MAP!.role = "Missing";
    expect(() => compileHarness(spec)).toThrow(CompilerError);
  });

  it("missing artifact output fails", () => {
    const spec = validSpec();
    spec.stages.MAP!.outputs = ["Nope"];
    expect(() => compileHarness(spec)).toThrow(CompilerError);
  });

  it("unknown gate fails at compile time", () => {
    const spec = validSpec();
    spec.stages.CONTRACT!.gate = { all: ["not_a_gate"], any: [] };

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("unknown gate");
  });

  it("gate artifact references must exist", () => {
    const spec = validSpec();
    spec.stages.CONTRACT!.gate = { all: [{ exists: "MissingArtifact" }], any: [] };

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("missing artifact reference");
  });

  it("implicit branching fails until routing semantics are explicit", () => {
    const spec = validSpec();
    spec.stages.ALT_PATCH = {
      from: "RepoMapped",
      to: "AltPatchCandidate",
      role: "PatchWorker",
      inputs: [],
      outputs: ["CandidatePatch"]
    };

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("branching requires explicit routing semantics");
  });

  it("absolute artifact path fails", () => {
    const spec = validSpec();
    spec.artifacts.RepoMap!.path = "/tmp/repo_map.md";
    expect(() => compileHarness(spec)).toThrow(CompilerError);
  });

  it("multiple start states fail", () => {
    const spec = validSpec();
    spec.stages.ORPHAN = {
      from: "OtherStart",
      to: "OtherEnd",
      role: "Cartographer",
      inputs: [],
      outputs: ["RepoMap"]
    };
    expect(() => compileHarness(spec)).toThrow(CompilerError);
  });

  it("stage order equals MVP sequence", async () => {
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/crew.mvp.yaml")));
    expect(compiled.stageOrder).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
  });

  it("first stage with input fails dataflow validation", () => {
    const spec = validSpec();
    spec.stages.CONTRACT!.inputs = ["IssueContract"];

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("input artifact is not available");
  });

  it("stage consuming future artifact fails dataflow validation", () => {
    const spec = validSpec();
    spec.stages.MAP!.inputs = ["CandidatePatch"];

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("input artifact is not available");
  });

  it("stage consuming its own output fails dataflow validation", () => {
    const spec = validSpec();
    spec.stages.MAP!.inputs = ["RepoMap"];

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("input artifact is not available");
  });

  it("stage consuming artifact declared but never produced earlier fails dataflow validation", () => {
    const spec = validSpec();
    spec.stages.MAP!.inputs = ["FinalPatch"];

    expect(() => compileHarness(spec)).toThrow(CompilerError);
    expect(() => compileHarness(spec)).toThrow("input artifact is not available");
  });
});
