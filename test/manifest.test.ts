import { describe, expect, it } from "vitest";
import { formatCrewManifestJson } from "../src/cli.js";
import type { CrewManifest } from "../src/manifest.js";
import { buildCrewManifestFromFile } from "../src/manifest.js";

describe("crew manifest", () => {
  it("builds manifest for canonical crew harness", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");

    expect(manifest.harnessName).toBe("CREW_MVP");
  });

  it("includes canonical stage order", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");

    expect(manifest.stageOrder).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
  });

  it("includes five stages", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");

    expect(manifest.stages).toHaveLength(5);
  });

  it("includes RELEASE inputs", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");
    const release = manifest.stages.find((stage) => stage.name === "RELEASE");

    expect(release?.inputs).toContain("CandidatePatch");
    expect(release?.inputs).toContain("VerifierReport");
  });

  it("includes artifact metadata", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");

    expect(manifest.artifacts.FinalPatch).toEqual({
      path: "artifacts/final.patch",
      required: true
    });
  });

  it("includes readable gate names", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");
    const release = manifest.stages.find((stage) => stage.name === "RELEASE");

    expect(release?.gates).toContain("final_patch_matches_verified_candidate");
  });

  it("json formatter parses", async () => {
    const manifest = await buildCrewManifestFromFile("harnesses/crew.mvp.yaml");
    const parsed = JSON.parse(formatCrewManifestJson(manifest)) as CrewManifest;

    expect(parsed.harnessName).toBe("CREW_MVP");
    expect(parsed.stageOrder).toEqual(manifest.stageOrder);
  });
});
