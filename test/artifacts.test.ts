import { describe, expect, it } from "vitest";
import path from "node:path";
import { ArtifactManager } from "../src/artifacts";
import { tempDir, validSpec } from "./helpers";

describe("ArtifactManager", () => {
  it("resolves artifact paths under run root", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    expect(manager.resolve("RepoMap")).toContain(path.join(root, "artifacts", "repo_map.md"));
  });

  it("writes artifacts and creates parent directories", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.exists("RepoMap")).toBe(true);
  });

  it("returns status with exists and size", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    const status = await manager.status("RepoMap");
    expect(status.exists).toBe(true);
    expect(status.sizeBytes).toBe(7);
  });

  it("rejects unknown artifacts", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new ArtifactManager(root, validSpec());
    expect(() => manager.resolve("Missing")).toThrow(/unknown artifact/);
  });
});
