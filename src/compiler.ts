import path from "node:path";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type { HarnessSpec, StageSpec } from "./schema";
import { HarnessSpecSchema } from "./schema";
import { NlahError } from "./errors";
import {
  assertAcyclic,
  findStartStates,
  traverseForward,
  type GraphEdge
} from "./graph";

export type CompiledHarness = {
  spec: HarnessSpec;
  stagesByFromState: Record<string, StageSpec[]>;
  stageOrder: string[];
};

function assertRelativeSafe(value: string, label: string): void {
  if (path.isAbsolute(value)) {
    throw new NlahError(`${label} must be relative: ${value}`);
  }
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new NlahError(`${label} must not escape root: ${value}`);
  }
}

export async function loadHarness(harnessPath: string): Promise<HarnessSpec> {
  const content = await readFile(harnessPath, "utf8");
  const document = YAML.parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new NlahError(document.errors.map((error) => error.message).join("; "));
  }
  const raw = document.toJSON();
  const parsed = HarnessSpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NlahError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

export async function compileHarness(spec: HarnessSpec): Promise<CompiledHarness> {
  const stageNames = Object.keys(spec.stages);
  if (stageNames.length === 0) {
    throw new NlahError("missing start state: harness has no stages");
  }

  assertRelativeSafe(spec.runtime.state_root, "runtime.state_root");
  assertRelativeSafe(spec.runtime.artifact_root, "runtime.artifact_root");

  for (const [artifactName, artifact] of Object.entries(spec.artifacts)) {
    assertRelativeSafe(artifact.path, `artifact ${artifactName}`);
  }

  const edges: GraphEdge[] = [];
  const stagesByFromState: Record<string, StageSpec[]> = {};

  for (const stageName of stageNames) {
    const stage = spec.stages[stageName];
    if (!spec.roles[stage.role]) {
      throw new NlahError(`missing role for stage ${stageName}: ${stage.role}`);
    }
    for (const artifactName of [...stage.inputs, ...stage.outputs]) {
      if (!spec.artifacts[artifactName]) {
        throw new NlahError(`missing artifact reference in stage ${stageName}: ${artifactName}`);
      }
    }
    edges.push({ stage: stageName, from: stage.from, to: stage.to });
    stagesByFromState[stage.from] ??= [];
    stagesByFromState[stage.from].push(stage);
  }

  const starts = findStartStates(edges);
  if (starts.length === 0) {
    throw new NlahError("missing start state");
  }
  if (starts.length > 1) {
    throw new NlahError(`invalid transitions: multiple start states (${starts.join(", ")})`);
  }

  assertAcyclic(edges);

  const orderedEdges = traverseForward(edges, starts[0]);
  const visitedStages = new Set(orderedEdges.map((edge) => edge.stage));
  const unreachable = stageNames.filter((stageName) => !visitedStages.has(stageName));
  if (unreachable.length > 0) {
    throw new NlahError(`unreachable stages: ${unreachable.join(", ")}`);
  }

  for (const stages of Object.values(stagesByFromState)) {
    stages.sort((a, b) => {
      const aName = stageNames.find((name) => spec.stages[name] === a) ?? "";
      const bName = stageNames.find((name) => spec.stages[name] === b) ?? "";
      return aName.localeCompare(bName);
    });
  }

  return {
    spec,
    stagesByFromState,
    stageOrder: orderedEdges.map((edge) => edge.stage)
  };
}
