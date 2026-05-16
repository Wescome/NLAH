import type { RuntimeState } from "./state.js";
import type { ArtifactManager } from "./artifacts.js";
import { ShellAdapter } from "./adapters.js";
import { GateError } from "./errors.js";
import type { GateContract } from "./schema.js";

export type GateEvalRecord = {
  passed: boolean;
  gate: string;
  message?: string;
  id?: string;
  uses?: string;
  reads?: string[];
  proves?: string;
  failureClass?: string;
  memberResults?: GateEvalRecord[];
};

export type GateFn = (
  state: RuntimeState,
  artifacts: ArtifactManager,
  args: unknown
) => Promise<GateEvalRecord>;

function pass(gate: string, message?: string): GateEvalRecord {
  return message === undefined ? { passed: true, gate } : { passed: true, gate, message };
}

function fail(gate: string, message: string): GateEvalRecord {
  return { passed: false, gate, message };
}

export function parseGateExpression(expr: unknown): { gateName: string; args: unknown } {
  if (isGateContract(expr)) {
    return { gateName: expr.uses, args: expr.args };
  }
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

function isGateContract(expr: unknown): expr is GateContract {
  return Boolean(
    expr &&
      typeof expr === "object" &&
      !Array.isArray(expr) &&
      typeof (expr as { id?: unknown }).id === "string" &&
      typeof (expr as { uses?: unknown }).uses === "string"
  );
}

export function hasExplicitGateFailureClass(expr: unknown): boolean {
  return Boolean(isGateContract(expr) && typeof (expr as { on_fail?: unknown }).on_fail === "string");
}

export function failureClassForGate(gateName: string): string {
  if (gateName === "exists") return "missing_artifact";
  if (gateName === "artifact_contract_satisfied") return "invalid_artifact";
  if (gateName === "patch_applies_cleanly") return "patch_does_not_apply";
  if (gateName === "verifier_accepts_patch" || gateName === "test_results_support_claims") {
    return "verifier_rejects";
  }
  return gateName;
}

export function normalizeGateContract(expr: unknown, fallbackId: string): GateContract {
  if (isGateContract(expr)) {
    const args = expr.args ?? (expr.reads?.length === 1 ? expr.reads[0] : undefined);
    return {
      id: expr.id,
      uses: expr.uses,
      reads: expr.reads ?? [],
      proves: expr.proves ?? expr.id,
      on_fail: expr.on_fail ?? failureClassForGate(expr.uses),
      ...(args === undefined ? {} : { args })
    };
  }

  const { gateName, args } = parseGateExpression(expr);
  const reads = typeof args === "string" ? [args] : [];
  return {
    id: fallbackId,
    uses: gateName,
    reads,
    proves: gateName,
    on_fail: failureClassForGate(gateName),
    ...(args === undefined ? {} : { args })
  };
}

async function readArtifact(artifacts: ArtifactManager, defaultName: string, args: unknown): Promise<string> {
  return artifacts.readText(typeof args === "string" ? args : defaultName);
}

export const gateRegistry: Record<string, GateFn> = {
  async artifact_exists(state, artifacts, args) {
    return gateRegistry.exists!(state, artifacts, args);
  },

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
  },

  async artifact_contract_satisfied(_state, artifacts, args) {
    if (typeof args !== "string") {
      throw new GateError("artifact_contract_satisfied gate requires an artifact name");
    }
    const result = await artifacts.validateContract(args);
    return result.passed
      ? pass("artifact_contract_satisfied", `${args} satisfies artifact contract`)
      : fail("artifact_contract_satisfied", result.message);
  }
};

export function registerGate(name: string, fn: GateFn): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new GateError("registerGate requires a non-empty gate name");
  }
  if (Object.prototype.hasOwnProperty.call(gateRegistry, name)) {
    throw new GateError(`gate already registered: ${name}`);
  }
  gateRegistry[name] = fn;
}

export async function evaluateGateExpression(
  expr: unknown,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateEvalRecord> {
  const contract = normalizeGateContract(expr, "gate");
  const gate = gateRegistry[contract.uses];
  if (!gate) {
    throw new GateError(`unknown gate: ${contract.uses}`);
  }
  const result = await gate(state, artifacts, contract.args);
  return {
    ...result,
    id: contract.id,
    uses: contract.uses,
    reads: contract.reads,
    proves: contract.proves,
    failureClass: contract.on_fail
  };
}

export async function evaluateGateSpec(
  gate: { all?: unknown[]; any?: unknown[] } | undefined,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateEvalRecord[]> {
  if (!gate) {
    return [];
  }

  const results: GateEvalRecord[] = [];
  for (const [index, expr] of (gate.all ?? []).entries()) {
    results.push(await evaluateGateExpression(normalizeGateContract(expr, `all-${index}`), state, artifacts));
  }

  const anyExpressions = gate.any ?? [];
  if (anyExpressions.length > 0) {
    const anyResults: GateEvalRecord[] = [];
    for (const [index, expr] of anyExpressions.entries()) {
      anyResults.push(await evaluateGateExpression(normalizeGateContract(expr, `any-${index}`), state, artifacts));
    }
    const passedGate = anyResults.find((result) => result.passed);
    results.push(
      passedGate
        ? {
            ...pass("any", `any-gate passed: ${passedGate.gate}`),
            id: "any",
            uses: "any",
            reads: anyResults.flatMap((result) => result.reads ?? []),
            proves: "at_least_one_gate_passed",
            failureClass: "verification_failed",
            memberResults: anyResults
          }
        : {
            ...fail("any", `no any-gate passed: ${anyResults.map((result) => result.gate).join(", ")}`),
            id: "any",
            uses: "any",
            reads: anyResults.flatMap((result) => result.reads ?? []),
            proves: "at_least_one_gate_passed",
            failureClass: "verification_failed",
            memberResults: anyResults
          }
    );
  }

  return results;
}
