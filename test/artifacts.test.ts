import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts.js";
import { ArtifactError } from "../src/errors.js";
import { tempDir, validSpec } from "./helpers.js";

describe("ArtifactManager", () => {
  it("resolves known artifact", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    expect(manager.resolve("RepoMap")).toBe(path.join(root, "artifacts", "repo_map.md"));
  });

  it("unknown artifact throws", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    expect(() => manager.resolve("Missing")).toThrow(ArtifactError);
  });

  it("writeText creates parent directories", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.readText("RepoMap")).toBe("content");
  });

  it("exists returns true after write", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.exists("RepoMap")).toBe(true);
  });

  it("status includes sizeBytes", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.status("RepoMap")).toMatchObject({ exists: true, sizeBytes: 7 });
  });

  it("path traversal is rejected", async () => {
    const root = await tempDir("nlah-artifacts-");
    const spec = validSpec();
    spec.artifacts.RepoMap!.path = "../repo_map.md";
    const manager = new ArtifactManager(root, spec);
    expect(() => manager.resolve("RepoMap")).toThrow(ArtifactError);
  });
});
