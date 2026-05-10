import { readFile } from "node:fs/promises";
import YAML from "yaml";
import path from "node:path";
import { HarnessSpecSchema, type HarnessSpec, type StageSpec } from "./schema.js";
import { SchemaValidationError, CompilerError } from "./errors.js";
import {
  buildStageGraph,
  findStartStates,
  assertNoCycles,
  assertReachableFrom,
  deterministicStageOrder
} from "./graph.js";
import { gateRegistry, parseGateExpression } from "./gates.js";

export type CompiledHarness = {
  spec: HarnessSpec;
  stagesByFromState: Record<string, Array<{ name: string; spec: StageSpec }>>;
  stageOrder: string[];
  startState: string;
  terminalStates: string[];
};

function assertRelativeSafe(value: string, label: string): void {
  if (path.isAbsolute(value)) {
    throw new CompilerError(`${label} must be relative: ${value}`);
  }
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new CompilerError(`${label} must not escape root: ${value}`);
  }
}

function assertInputArtifactsAvailable(
  spec: HarnessSpec,
  stageOrder: string[]
): void {
  const availableArtifacts = new Set<string>();

  for (const stageName of stageOrder) {
    const stage = spec.stages[stageName];
    if (!stage) {
      throw new CompilerError(`invalid stage order references missing stage: ${stageName}`);
    }

    for (const artifactName of stage.inputs) {
      if (!availableArtifacts.has(artifactName)) {
        throw new CompilerError(
          `input artifact is not available for stage ${stageName}: ${artifactName}`
        );
      }
    }

    for (const artifactName of stage.outputs) {
      availableArtifacts.add(artifactName);
    }
  }
}

const gateArtifactArgs = new Set([
  "exists",
  "patch_applies_cleanly",
  "repo_map_names_relevant_files",
  "repo_map_names_test_entrypoints",
  "verifier_accepts_patch",
  "test_results_support_claims"
]);

function assertGateReferencesValid(spec: HarnessSpec): void {
  for (const [stageName, stage] of Object.entries(spec.stages)) {
    const expressions = [...(stage.gate?.all ?? []), ...(stage.gate?.any ?? [])];
    for (const expression of expressions) {
      try {
        const { gateName, args } = parseGateExpression(expression);
        if (!gateRegistry[gateName]) {
          throw new CompilerError(`unknown gate in stage ${stageName}: ${gateName}`);
        }
        if (typeof args === "string" && gateArtifactArgs.has(gateName) && !spec.artifacts[args]) {
          throw new CompilerError(`missing artifact reference in gate ${gateName} for stage ${stageName}: ${args}`);
        }
      } catch (error) {
        if (error instanceof CompilerError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new CompilerError(`invalid gate in stage ${stageName}: ${message}`);
      }
    }
  }
}

function assertNoImplicitBranching(stagesByFromState: Record<string, Array<{ name: string; spec: StageSpec }>>): void {
  for (const [state, stages] of Object.entries(stagesByFromState)) {
    if (stages.length > 1) {
      throw new CompilerError(
        `branching requires explicit routing semantics from state ${state}: ${stages.map((stage) => stage.name).join(", ")}`
      );
    }
  }
}

export async function loadHarness(filePath: string): Promise<HarnessSpec> {
  const content = await readFile(filePath, "utf8");
  const document = YAML.parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new SchemaValidationError(document.errors.map((error) => error.message).join("; "));
  }

  const parsed = HarnessSpecSchema.safeParse(document.toJSON());
  if (!parsed.success) {
    throw new SchemaValidationError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

export function compileHarness(spec: HarnessSpec): CompiledHarness {
  const stageEntries = Object.entries(spec.stages);
  if (stageEntries.length === 0) {
    throw new CompilerError("no stages exist");
  }
  if (Object.keys(spec.roles).length === 0) {
    throw new CompilerError("no roles exist");
  }
  if (Object.keys(spec.artifacts).length === 0) {
    throw new CompilerError("no artifacts exist");
  }

  assertRelativeSafe(spec.runtime.state_root, "runtime.state_root");
  assertRelativeSafe(spec.runtime.artifact_root, "runtime.artifact_root");

  for (const [artifactName, artifact] of Object.entries(spec.artifacts)) {
    assertRelativeSafe(artifact.path, `artifact ${artifactName}`);
  }

  const stagesByFromState: Record<string, Array<{ name: string; spec: StageSpec }>> = {};
  for (const [stageName, stage] of stageEntries) {
    if (!spec.roles[stage.role]) {
      throw new CompilerError(`missing role for stage ${stageName}: ${stage.role}`);
    }
    for (const artifactName of stage.inputs) {
      if (!spec.artifacts[artifactName]) {
        throw new CompilerError(`missing artifact input in stage ${stageName}: ${artifactName}`);
      }
    }
    for (const artifactName of stage.outputs) {
      if (!spec.artifacts[artifactName]) {
        throw new CompilerError(`missing artifact output in stage ${stageName}: ${artifactName}`);
      }
    }

    const fromStateStages = stagesByFromState[stage.from] ?? [];
    fromStateStages.push({ name: stageName, spec: stage });
    stagesByFromState[stage.from] = fromStateStages;
  }

  for (const stages of Object.values(stagesByFromState)) {
    stages.sort((a, b) => a.name.localeCompare(b.name));
  }
  assertNoImplicitBranching(stagesByFromState);
  assertGateReferencesValid(spec);

  const graph = buildStageGraph(spec.stages);
  const startStates = findStartStates(graph);
  if (startStates.length !== 1) {
    throw new CompilerError(`expected exactly one start state, found ${startStates.length}`);
  }
  const startState = startStates[0];
  if (!startState) {
    throw new CompilerError("missing start state");
  }
  assertNoCycles(graph);
  assertReachableFrom(graph, startState);

  const terminalStates = [...graph.states]
    .filter((state) => (graph.incoming.get(state)?.length ?? 0) > 0)
    .filter((state) => (graph.outgoing.get(state)?.length ?? 0) === 0)
    .sort();

  const stageOrder = deterministicStageOrder(spec.stages, startState);
  assertInputArtifactsAvailable(spec, stageOrder);

  return {
    spec,
    stagesByFromState,
    stageOrder,
    startState,
    terminalStates
  };
}
