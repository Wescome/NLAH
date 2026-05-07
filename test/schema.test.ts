import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { compileHarness, loadHarness } from "../src/compiler";
import { HarnessSpecSchema } from "../src/schema";
import { tempDir, validSpec } from "./helpers";

describe("schema validation", () => {
  it("loads a valid harness", async () => {
    const spec = await loadHarness(path.resolve("harnesses/coding_swarm.mvp.yaml"));
    expect(spec.nlahspec).toBe("0.1");
    expect(spec.stages.RELEASE.to).toBe("PullRequestReady");
  });

  it("fails on missing role", async () => {
    const spec = validSpec();
    spec.stages.MAP.role = "Missing";
    await expect(compileHarness(spec)).rejects.toThrow(/missing role/);
  });

  it("fails on missing artifact reference", async () => {
    const spec = validSpec();
    spec.stages.MAP.outputs = ["Nope"];
    await expect(compileHarness(spec)).rejects.toThrow(/missing artifact reference/);
  });

  it("fails on unsupported version", () => {
    const raw = { ...validSpec(), nlahspec: "0.2" };
    expect(HarnessSpecSchema.safeParse(raw).success).toBe(false);
  });

  it("fails on absolute artifact path", async () => {
    const spec = validSpec();
    spec.artifacts.RepoMap.path = "/tmp/repo_map.md";
    await expect(compileHarness(spec)).rejects.toThrow(/must be relative/);
  });

  it("fails on duplicate stage names in YAML", async () => {
    const root = await tempDir("nlah-schema-");
    const harness = path.join(root, "harness.yaml");
    await writeFile(
      harness,
      [
        'nlahspec: "0.1"',
        "harness: { name: X, task_family: x, objective: x }",
        "runtime: { state_root: runs/current/state, artifact_root: runs/current/artifacts }",
        "roles: { R: { responsibility: x } }",
        "artifacts: { A: { path: artifacts/a.txt } }",
        "stages:",
        "  STEP: { from: A, to: B, role: R, outputs: [A] }",
        "  STEP: { from: B, to: C, role: R, outputs: [A] }"
      ].join("\n"),
      "utf8"
    );
    await expect(loadHarness(harness)).rejects.toThrow(/Map keys must be unique/);
  });
});
