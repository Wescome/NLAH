import { describe, expect, it } from "vitest";
import path from "node:path";
import { FsArtifactManager } from "../src/artifacts.js";
import { ArtifactError } from "../src/errors.js";
import { tempDir, validSpec } from "./helpers.js";

describe("ArtifactManager", () => {
  it("resolves known artifact", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new FsArtifactManager(root, validSpec());
    expect(manager.resolve("RepoMap")).toBe(path.join(root, "artifacts", "repo_map.md"));
  });

  it("unknown artifact throws", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new FsArtifactManager(root, validSpec());
    expect(() => manager.resolve("Missing")).toThrow(ArtifactError);
  });

  it("writeText creates parent directories", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new FsArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.readText("RepoMap")).toBe("content");
  });

  it("exists returns true after write", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new FsArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.exists("RepoMap")).toBe(true);
  });

  it("status includes sizeBytes", async () => {
    const root = await tempDir("nlah-artifacts-");
    const manager = new FsArtifactManager(root, validSpec());
    await manager.writeText("RepoMap", "content");
    expect(await manager.status("RepoMap")).toMatchObject({ exists: true, sizeBytes: 7 });
  });

  it("path traversal is rejected", async () => {
    const root = await tempDir("nlah-artifacts-");
    const spec = validSpec();
    spec.artifacts.RepoMap!.path = "../repo_map.md";
    const manager = new FsArtifactManager(root, spec);
    expect(() => manager.resolve("RepoMap")).toThrow(ArtifactError);
  });

  it("validates markdown required sections", async () => {
    const root = await tempDir("nlah-artifacts-contract-");
    const spec = validSpec();
    spec.artifacts.RepoMap!.contract = {
      kind: "markdown",
      required_sections: ["Relevant files", "Relevant tests"]
    };
    const manager = new FsArtifactManager(root, spec);

    await manager.writeText("RepoMap", "# Repo Map\n\n## Relevant files\n\n- src/math.ts\n");
    await expect(manager.validateContract("RepoMap")).resolves.toMatchObject({ passed: false });

    await manager.writeText("RepoMap", "# Repo Map\n\n## Relevant files\n\n- src/math.ts\n\n## Relevant tests\n\n- test/math.test.ts\n");
    await expect(manager.validateContract("RepoMap")).resolves.toMatchObject({ passed: true });
  });

  it("validates JSON required fields", async () => {
    const root = await tempDir("nlah-artifacts-json-contract-");
    const spec = validSpec();
    spec.artifacts.VerifierReport!.contract = {
      kind: "json",
      required_fields: ["verdict"]
    };
    const manager = new FsArtifactManager(root, spec);

    await manager.writeText("VerifierReport", "{");
    await expect(manager.validateContract("VerifierReport")).resolves.toMatchObject({ passed: false });

    await manager.writeText("VerifierReport", JSON.stringify({ verdict: "PASS" }));
    await expect(manager.validateContract("VerifierReport")).resolves.toMatchObject({ passed: true });
  });
});
