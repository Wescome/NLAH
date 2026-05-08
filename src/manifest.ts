import { compileHarness, loadHarness, type CompiledHarness } from "./compiler.js";
import { parseGateExpression } from "./gates.js";
import type { GateSpec } from "./schema.js";

export type CrewStageManifest = {
  name: string;
  from: string;
  to: string;
  role: string;
  worker?: string;
  inputs: string[];
  outputs: string[];
  gates: string[];
};

export type CrewManifest = {
  harnessName: string;
  taskFamily: string;
  objective: string;
  stageOrder: string[];
  startState: string;
  terminalStates: string[];
  artifacts: Record<string, { path: string; required: boolean }>;
  stages: CrewStageManifest[];
};

function formatGateExpression(expr: unknown): string {
  const { gateName, args } = parseGateExpression(expr);
  if (args === undefined) {
    return gateName;
  }
  if (typeof args === "string" || typeof args === "number" || typeof args === "boolean") {
    return `${gateName}: ${String(args)}`;
  }
  return `${gateName}: ${JSON.stringify(args)}`;
}

function formatGateSpec(gate: GateSpec | undefined): string[] {
  if (!gate) {
    return [];
  }
  return [...(gate.all ?? []), ...(gate.any ?? [])].map(formatGateExpression);
}

export function buildCrewManifest(compiled: CompiledHarness): CrewManifest {
  const artifacts: CrewManifest["artifacts"] = {};
  for (const [name, artifact] of Object.entries(compiled.spec.artifacts).sort(([a], [b]) => a.localeCompare(b))) {
    artifacts[name] = {
      path: artifact.path,
      required: artifact.required
    };
  }

  return {
    harnessName: compiled.spec.harness.name,
    taskFamily: compiled.spec.harness.task_family,
    objective: compiled.spec.harness.objective,
    stageOrder: compiled.stageOrder,
    startState: compiled.startState,
    terminalStates: compiled.terminalStates,
    artifacts,
    stages: compiled.stageOrder.map((stageName) => {
      const stage = compiled.spec.stages[stageName];
      if (!stage) {
        throw new Error(`compiled stage is missing from spec: ${stageName}`);
      }
      return {
        name: stageName,
        from: stage.from,
        to: stage.to,
        role: stage.role,
        ...(stage.worker === undefined ? {} : { worker: stage.worker }),
        inputs: stage.inputs,
        outputs: stage.outputs,
        gates: formatGateSpec(stage.gate)
      };
    })
  };
}

export async function buildCrewManifestFromFile(harnessPath: string): Promise<CrewManifest> {
  return buildCrewManifest(compileHarness(await loadHarness(harnessPath)));
}
