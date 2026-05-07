import { z } from "zod";

export const HarnessMetadataSchema = z.object({
  name: z.string(),
  task_family: z.string(),
  objective: z.string()
});

export const RuntimeConfigSchema = z.object({
  max_patch_workers: z.number().default(1),
  max_repair_rounds: z.number().default(0),
  state_root: z.string(),
  artifact_root: z.string()
});

export const RoleSpecSchema = z.object({
  responsibility: z.string()
});

export const ArtifactSpecSchema = z.object({
  path: z.string(),
  required: z.boolean().default(true)
});

export const GateSpecSchema = z.object({
  all: z.array(z.any()).default([]),
  any: z.array(z.any()).default([])
});

export const StageSpecSchema = z.object({
  from: z.string(),
  to: z.string(),
  role: z.string(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  gate: GateSpecSchema.optional()
});

export const HarnessSpecSchema = z.object({
  nlahspec: z.literal("0.1"),
  harness: HarnessMetadataSchema,
  runtime: RuntimeConfigSchema,
  roles: z.record(z.string(), RoleSpecSchema),
  artifacts: z.record(z.string(), ArtifactSpecSchema),
  stages: z.record(z.string(), StageSpecSchema),
  failure_taxonomy: z.record(z.string(), z.string()).optional()
});

export type HarnessMetadata = z.infer<typeof HarnessMetadataSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RoleSpec = z.infer<typeof RoleSpecSchema>;
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type GateSpec = z.infer<typeof GateSpecSchema>;
export type StageSpec = z.infer<typeof StageSpecSchema>;
export type HarnessSpec = z.infer<typeof HarnessSpecSchema>;
