import type { RuntimeState } from "./state.js";
import type { ArtifactManager } from "./artifacts.js";
import { ShellAdapter } from "./adapters.js";
import { GateError } from "./errors.js";

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

function pass(gate: string, message?: string): GateResult {
  return message === undefined ? { passed: true, gate } : { passed: true, gate, message };
}

function fail(gate: string, message: string): GateResult {
  return { passed: false, gate, message };
}

export function parseGateExpression(expr: unknown): { gateName: string; args: unknown } {
  if (typeof expr === "string") {
    return { gateName: expr, args: undefined };
  }
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    const keys = Object.keys(expr);
    if (keys.length !== 1) {
      throw new GateError("object gate expression must have exactly one key");
    }
    const gateName = keys[0];
    if (!gateName) {
      throw new GateError("gate name must not be empty");
    }
    return { gateName, args: (expr as Record<string, unknown>)[gateName] };
  }
  throw new GateError("invalid gate expression");
}

async function readArtifact(artifacts: ArtifactManager, defaultName: string, args: unknown): Promise<string> {
  return artifacts.readText(typeof args === "string" ? args : defaultName);
}

export const gateRegistry: Record<string, GateFn> = {
  async exists(_state, artifacts, args) {
    if (typeof args !== "string") {
      throw new GateError("exists gate requires an artifact name");
    }
    const status = await artifacts.status(args);
    return status.exists && (status.sizeBytes ?? 0) > 0
      ? pass("exists", `${args} exists`)
      : fail("exists", `${args} missing or empty`);
  },

  async patch_applies_cleanly(state, artifacts, args) {
    const artifactName = typeof args === "string" ? args : "CandidatePatch";
    const adapter = new ShellAdapter([state.repoPath, state.runRoot]);
    const result = await adapter.run(["git", "apply", "--check", artifacts.resolve(artifactName)], state.repoPath);
    return result.ok
      ? pass("patch_applies_cleanly")
      : fail("patch_applies_cleanly", result.stderr || result.stdout || "git apply --check failed");
  },

  async repo_map_names_relevant_files(_state, artifacts, args) {
    const content = await readArtifact(artifacts, "RepoMap", args);
    const hasHeading = /(^|\n)#+\s*Relevant files\b/i.test(content);
    const hasPathLikeToken = /\b[\w./-]+\.[A-Za-z0-9]+\b/.test(content);
    return hasHeading && hasPathLikeToken
      ? pass("repo_map_names_relevant_files")
      : fail("repo_map_names_relevant_files", "RepoMap must include Relevant files and at least one path-like token");
  },

  async repo_map_names_test_entrypoints(_state, artifacts, args) {
    const content = await readArtifact(artifacts, "RepoMap", args);
    return /Relevant tests|Test entrypoints/i.test(content)
      ? pass("repo_map_names_test_entrypoints")
      : fail("repo_map_names_test_entrypoints", "RepoMap must include Relevant tests or Test entrypoints");
  },

  async verifier_accepts_patch(_state, artifacts, args) {
    const content = await readArtifact(artifacts, "VerifierReport", args);
    return content.includes("Verdict: PASS")
      ? pass("verifier_accepts_patch")
      : fail("verifier_accepts_patch", "VerifierReport must contain Verdict: PASS");
  },

  async test_results_support_claims(_state, artifacts, args) {
    const content = await readArtifact(artifacts, "VerifierReport", args);
    return content.includes("Tests run")
      ? pass("test_results_support_claims")
      : fail("test_results_support_claims", "VerifierReport must contain Tests run");
  },

  async final_patch_matches_verified_candidate(_state, artifacts) {
    const finalPatch = await artifacts.readText("FinalPatch");
    const candidatePatch = await artifacts.readText("CandidatePatch");
    return finalPatch.trim() === candidatePatch.trim()
      ? pass("final_patch_matches_verified_candidate")
      : fail("final_patch_matches_verified_candidate", "FinalPatch does not match CandidatePatch");
  }
};

export async function evaluateGateExpression(
  expr: unknown,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult> {
  const { gateName, args } = parseGateExpression(expr);
  const gate = gateRegistry[gateName];
  if (!gate) {
    throw new GateError(`unknown gate: ${gateName}`);
  }
  return gate(state, artifacts, args);
}

export async function evaluateGateSpec(
  gate: { all?: unknown[]; any?: unknown[] } | undefined,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult[]> {
  if (!gate) {
    return [];
  }

  const results: GateResult[] = [];
  for (const expr of gate.all ?? []) {
    results.push(await evaluateGateExpression(expr, state, artifacts));
  }

  const anyExpressions = gate.any ?? [];
  if (anyExpressions.length > 0) {
    const anyResults: GateResult[] = [];
    for (const expr of anyExpressions) {
      anyResults.push(await evaluateGateExpression(expr, state, artifacts));
    }
    results.push(...anyResults);
    if (!anyResults.some((result) => result.passed)) {
      results.push(fail("any", "no any-gate passed"));
    }
  }

  return results;
}
