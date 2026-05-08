import { describe, expect, it } from "vitest";
import path from "node:path";
import { compileHarness, loadHarness } from "../src/compiler.js";
import { CompilerError } from "../src/errors.js";
import { validSpec } from "./helpers.js";

describe("compiler", () => {
  it("valid harness compiles", async () => {
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
    const compiled = compileHarness(await loadHarness(path.resolve("harnesses/coding_swarm.mvp.yaml")));
    expect(compiled.stageOrder).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
  });
});
