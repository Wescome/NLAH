import { execa } from "execa";
import type { ArtifactManager } from "./artifacts";
import type { GateSpec } from "./schema";
import type { RuntimeState } from "./state";

export type GateResult = {
  passed: boolean;
  gate: string;
  message?: string;
};

export type GateFn = (
  state: RuntimeState,
  artifacts: ArtifactManager,
  args: unknown
) => Promise<GateResult>;

function fail(gate: string, message: string): GateResult {
  return { passed: false, gate, message };
}

function pass(gate: string, message = ""): GateResult {
  return { passed: true, gate, message };
}

function parseGateEntry(entry: unknown): { name: string; args: unknown } {
  if (typeof entry === "string") {
    return { name: entry, args: undefined };
  }
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const keys = Object.keys(entry);
    if (keys.length === 1) {
      const name = keys[0];
      return { name, args: (entry as Record<string, unknown>)[name] };
    }
  }
  return { name: "invalid_gate", args: entry };
}

async function readNamedArtifact(artifacts: ArtifactManager, preferred: string, args: unknown): Promise<string> {
  const name = typeof args === "string" ? args : preferred;
  return artifacts.readText(name);
}

export const gateRegistry: Record<string, GateFn> = {
  async exists(_state, artifacts, args) {
    if (typeof args !== "string") {
      return fail("exists", "exists gate requires an artifact name");
    }
    const status = await artifacts.status(args);
    return status.exists && (status.sizeBytes ?? 0) > 0
      ? pass("exists", `${args} exists`)
      : fail("exists", `${args} missing or empty`);
  },

  async patch_applies_cleanly(state, artifacts, args) {
    const artifactName = typeof args === "string" ? args : "CandidatePatch";
    const patchPath = artifacts.resolve(artifactName);
    const result = await execa("git", ["apply", "--check", patchPath], {
      cwd: state.repoPath,
      reject: false
    });
    return result.exitCode === 0
      ? pass("patch_applies_cleanly")
      : fail("patch_applies_cleanly", result.stderr || result.stdout || "git apply --check failed");
  },

  async repo_map_names_relevant_files(_state, artifacts, args) {
    const content = await readNamedArtifact(artifacts, "RepoMap", args);
    const hasHeading = /^#+\s*Relevant files\b/im.test(content) || /^\d+\.\s*Relevant files\b/im.test(content);
    const afterHeading = content.split(/Relevant files/im)[1] ?? "";
    const hasPathLikeLine = afterHeading
      .split(/\r?\n/)
      .some((line) => /^\s*[-*]?\s*`?[\w./-]+\.[\w-]+`?\s*$/.test(line.trim()));
    return hasHeading && hasPathLikeLine
      ? pass("repo_map_names_relevant_files")
      : fail("repo_map_names_relevant_files", "repo map must name relevant files");
  },

  async repo_map_names_test_entrypoints(_state, artifacts, args) {
    const content = await readNamedArtifact(artifacts, "RepoMap", args);
    return /Relevant tests|Test entrypoints/i.test(content)
      ? pass("repo_map_names_test_entrypoints")
      : fail("repo_map_names_test_entrypoints", "repo map must name test entrypoints");
  },

  async verifier_accepts_patch(_state, artifacts, args) {
    const content = await readNamedArtifact(artifacts, "VerifierReport", args);
    return /Verdict:\s*PASS\b/.test(content)
      ? pass("verifier_accepts_patch")
      : fail("verifier_accepts_patch", "verifier report did not pass");
  },

  async test_results_support_claims(_state, artifacts, args) {
    const content = await readNamedArtifact(artifacts, "VerifierReport", args);
    return /Tests run/i.test(content)
      ? pass("test_results_support_claims")
      : fail("test_results_support_claims", "verifier report must include tests run");
  },

  async final_patch_matches_verified_candidate(_state, artifacts) {
    const finalPatch = await artifacts.readText("FinalPatch");
    const candidatePatch = await artifacts.readText("CandidatePatch");
    return finalPatch === candidatePatch
      ? pass("final_patch_matches_verified_candidate")
      : fail("final_patch_matches_verified_candidate", "final.patch differs from candidate.patch");
  }
};

export async function evaluateGateEntry(
  entry: unknown,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult> {
  const { name, args } = parseGateEntry(entry);
  const gate = gateRegistry[name];
  if (!gate) {
    return fail(name, `unknown gate: ${name}`);
  }
  return gate(state, artifacts, args);
}

export async function evaluateGateSpec(
  gateSpec: GateSpec | undefined,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult[]> {
  if (!gateSpec) {
    return [];
  }

  const results: GateResult[] = [];
  for (const entry of gateSpec.all) {
    results.push(await evaluateGateEntry(entry, state, artifacts));
  }

  if (gateSpec.any.length > 0) {
    const anyResults = [];
    for (const entry of gateSpec.any) {
      anyResults.push(await evaluateGateEntry(entry, state, artifacts));
    }
    if (!anyResults.some((result) => result.passed)) {
      results.push(fail("any", "no any-gate passed"));
    }
    results.push(...anyResults);
  }

  return results;
}
