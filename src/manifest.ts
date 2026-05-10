import { compileHarness, loadHarness, type CompiledHarness } from "./compiler.js";
import { normalizeGateContract } from "./gates.js";
import type { ArtifactContract, GateContract, GateSpec } from "./schema.js";

export type CrewStageManifest = {
  name: string;
  from: string;
  to: string;
  role: string;
  worker?: string;
  inputs: string[];
  outputs: string[];
  gates: string[];
  gateContracts: GateContract[];
  onFailure?: Record<string, string>;
};

export type CrewManifest = {
  harnessName: string;
  taskFamily: string;
  objective: string;
  nlahspec: "0.1" | "0.2";
  runtimePolicy: {
    graphMode: string;
    maxRetriesPerStage: number;
    maxTotalRetries: number;
    defaultFailureAction: string;
    resume: boolean;
  };
  stageOrder: string[];
  startState: string;
  terminalStates: string[];
  warnings: string[];
  roles: Record<string, { responsibility: string; reads?: string[]; writes?: string[]; must_not?: string[] }>;
  artifacts: Record<string, { path: string; required: boolean; contract?: ArtifactContract }>;
  failureTaxonomy: Record<string, string>;
  stages: CrewStageManifest[];
};

function formatGateExpression(expr: unknown): string {
  const { uses: gateName, args } = normalizeGateContract(expr, "gate");
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

function formatGateContracts(stageName: string, gate: GateSpec | undefined): GateContract[] {
  if (!gate) return [];
  return [
    ...(gate.all ?? []).map((expr, index) => normalizeGateContract(expr, `${stageName}-all-${index}`)),
    ...(gate.any ?? []).map((expr, index) => normalizeGateContract(expr, `${stageName}-any-${index}`))
  ];
}

export function buildCrewManifest(compiled: CompiledHarness): CrewManifest {
  const artifacts: CrewManifest["artifacts"] = {};
  for (const [name, artifact] of Object.entries(compiled.spec.artifacts).sort(([a], [b]) => a.localeCompare(b))) {
    artifacts[name] = {
      path: artifact.path,
      required: artifact.required,
      ...(artifact.contract === undefined ? {} : { contract: artifact.contract })
    };
  }

  const roles: CrewManifest["roles"] = {};
  for (const [name, role] of Object.entries(compiled.spec.roles).sort(([a], [b]) => a.localeCompare(b))) {
    roles[name] = {
      responsibility: role.responsibility,
      ...(role.reads === undefined ? {} : { reads: role.reads }),
      ...(role.writes === undefined ? {} : { writes: role.writes }),
      ...(role.must_not === undefined ? {} : { must_not: role.must_not })
    };
  }

  return {
    nlahspec: compiled.spec.nlahspec,
    harnessName: compiled.spec.harness.name,
    taskFamily: compiled.spec.harness.task_family,
    objective: compiled.spec.harness.objective,
    runtimePolicy: {
      graphMode: compiled.spec.runtime.graph_mode,
      maxRetriesPerStage: compiled.spec.runtime.max_repair_rounds,
      maxTotalRetries: compiled.spec.runtime.max_total_retries ?? compiled.spec.runtime.max_repair_rounds,
      defaultFailureAction: compiled.spec.runtime.default_failure_action,
      resume: compiled.spec.runtime.resume
    },
    stageOrder: compiled.stageOrder,
    startState: compiled.startState,
    terminalStates: compiled.terminalStates,
    warnings: compiled.warnings,
    roles,
    artifacts,
    failureTaxonomy: compiled.spec.failure_taxonomy ?? {},
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
        gates: formatGateSpec(stage.gate),
        gateContracts: formatGateContracts(stageName, stage.gate),
        ...(stage.on_failure === undefined ? {} : { onFailure: stage.on_failure })
      };
    })
  };
}

export async function buildCrewManifestFromFile(harnessPath: string): Promise<CrewManifest> {
  return buildCrewManifest(compileHarness(await loadHarness(harnessPath)));
}
