import { z } from "zod";

export const HarnessMetadataSchema = z.object({
  name: z.string().min(1),
  task_family: z.string().min(1),
  objective: z.string().min(1)
});

export const RuntimeConfigSchema = z.object({
  max_patch_workers: z.number().int().nonnegative().default(1),
  max_repair_rounds: z.number().int().nonnegative().default(0),
  max_total_retries: z.number().int().nonnegative().optional(),
  graph_mode: z.literal("linear").default("linear"),
  default_failure_action: z.string().min(1).default("abort"),
  resume: z.boolean().default(false),
  state_root: z.string().min(1),
  artifact_root: z.string().min(1)
});

export const RoleSpecSchema = z.object({
  responsibility: z.string().min(1),
  reads: z.array(z.string()).optional(),
  writes: z.array(z.string()).optional(),
  must_not: z.array(z.string()).optional()
});

export const ArtifactContractSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown"),
    required_sections: z.array(z.string().min(1)).optional(),
    required_patterns: z.array(z.string().min(1)).optional()
  }),
  z.object({
    kind: z.literal("json"),
    required_fields: z.array(z.string().min(1)).optional()
  }),
  z.object({
    kind: z.literal("text"),
    non_empty: z.boolean().optional(),
    required_patterns: z.array(z.string().min(1)).optional()
  })
]);

export const ArtifactSpecSchema = z.object({
  path: z.string().min(1),
  required: z.boolean().default(true),
  contract: ArtifactContractSchema.optional()
});

export const GateContractSchema = z.object({
  id: z.string().min(1),
  uses: z.string().min(1),
  reads: z.array(z.string().min(1)).default([]),
  proves: z.string().min(1),
  on_fail: z.string().min(1),
  args: z.unknown().optional()
});

export const GateSpecSchema = z.object({
  all: z.array(z.unknown()).default([]),
  any: z.array(z.unknown()).default([])
});

export const StageSpecSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  role: z.string().min(1),
  worker: z.string().min(1).optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  gate: GateSpecSchema.optional(),
  gates: GateSpecSchema.optional(),
  on_failure: z.record(z.string(), z.string()).optional(),
  /** Per-stage attempt cap. Overrides `runtime.max_repair_rounds` when set. */
  max_stage_attempts: z.number().int().positive().optional()
});

function normalizeHarnessInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const record = input as Record<string, unknown>;
  const runtimePolicy = record.runtime_policy;
  const runtime =
    record.runtime ??
    (runtimePolicy && typeof runtimePolicy === "object" && !Array.isArray(runtimePolicy)
      ? runtimePolicy
      : undefined);

  const normalized: Record<string, unknown> = {
    ...record,
    ...(runtime === undefined ? {} : { runtime })
  };
  delete normalized.runtime_policy;

  if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) {
    const runtimeRecord = runtime as Record<string, unknown>;
    if (runtimeRecord.max_retries_per_stage !== undefined) {
      normalized.runtime = {
        ...runtimeRecord,
        max_repair_rounds: runtimeRecord.max_retries_per_stage
      };
    }
  }

  if (record.stages && typeof record.stages === "object" && !Array.isArray(record.stages)) {
    const stages: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(record.stages as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const stage = value as Record<string, unknown>;
        stages[name] = {
          ...stage,
          gate: stage.gate ?? stage.gates
        };
      } else {
        stages[name] = value;
      }
    }
    normalized.stages = stages;
  }

  if (record.failure_taxonomy && typeof record.failure_taxonomy === "object" && !Array.isArray(record.failure_taxonomy)) {
    const taxonomy: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.failure_taxonomy as Record<string, unknown>)) {
      if (typeof value === "string") {
        taxonomy[key] = value;
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const valueRecord = value as Record<string, unknown>;
        if (typeof valueRecord.default_action === "string") {
          taxonomy[key] = valueRecord.default_action;
        }
      }
    }
    normalized.failure_taxonomy = taxonomy;
  }

  return normalized;
}

export const HarnessSpecSchema = z.preprocess(
  normalizeHarnessInput,
  z.object({
    nlahspec: z.union([z.literal("0.1"), z.literal("0.2")]),
    // Contribution #4: explicit lineage field so compileHarness does not strip it.
    lineage: z.object({ source_refs: z.array(z.string()) }).optional(),
    harness: HarnessMetadataSchema,
    runtime: RuntimeConfigSchema,
    roles: z.record(z.string(), RoleSpecSchema),
    artifacts: z.record(z.string(), ArtifactSpecSchema),
    stages: z.record(z.string(), StageSpecSchema),
    failure_taxonomy: z.record(z.string(), z.string()).optional()
  })
);

export type HarnessMetadata = z.infer<typeof HarnessMetadataSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RoleSpec = z.infer<typeof RoleSpecSchema>;
export type ArtifactContract = z.infer<typeof ArtifactContractSchema>;
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type GateContract = z.infer<typeof GateContractSchema>;
export type GateSpec = z.infer<typeof GateSpecSchema>;
export type StageSpec = z.infer<typeof StageSpecSchema>;
export type HarnessSpec = z.infer<typeof HarnessSpecSchema>;
