# NLAH TypeScript Coding Agent Implementation Contract

## Objective

Implement the first runnable version of `Wescome/NLAH`.

This repository is a **TypeScript-first Natural-Language Agent Harness runtime**.

The runtime must execute this pipeline:

```text
NLAH YAML harness
→ Zod validation
→ compiled stage graph
→ deterministic runtime execution
→ artifact creation
→ gate evaluation
→ JSONL trace ledger
→ PASS / FAIL result
```

Do not implement LLM calls yet.

Do not implement real coding agents yet.

Do not implement LangGraph yet.

First prove the harness runtime works deterministically.

---

# Global Rules

## Required stack

Use:

```text
TypeScript
Node.js
pnpm
Zod
Commander
tsx
Vitest
yaml
execa
fs/promises
path
crypto
```

## Runtime invariants

The implementation must preserve these invariants:

```text
1. Harness YAML drives execution.
2. Runtime code must not hardcode business stage names.
3. A stage may complete only when declared output artifacts exist.
4. A stage may transition only when declared gates pass.
5. Every stage start, gate result, transition, and completion must be written to JSONL trace.
6. Artifact paths must be relative and resolved under the run directory.
7. Shell commands must use execa with argument arrays.
8. No shell=true.
9. No LLM integration in v0.
10. No hidden global mutable runtime state.
```

---

# Expected repository structure

Ensure the repo has this structure:

```text
NLAH/
├── README.md
├── LICENSE
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
│
├── src/
│   ├── index.ts
│   ├── cli.ts
│   ├── schema.ts
│   ├── compiler.ts
│   ├── graph.ts
│   ├── state.ts
│   ├── runtime.ts
│   ├── gates.ts
│   ├── artifacts.ts
│   ├── trace.ts
│   ├── adapters.ts
│   └── errors.ts
│
├── harnesses/
│   └── coding_swarm.mvp.yaml
│
├── roles/
│   ├── cartographer.md
│   ├── patch_worker.md
│   ├── verifier.md
│   └── release_agent.md
│
├── examples/
│   ├── TASK.md
│   └── target_repo_stub/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   └── math.ts
│       └── test/
│           └── math.test.ts
│
└── test/
    ├── schema.test.ts
    ├── compiler.test.ts
    ├── graph.test.ts
    ├── artifacts.test.ts
    ├── gates.test.ts
    ├── trace.test.ts
    └── runtime.test.ts
```

---

# Package setup

## `package.json`

Create or update:

```json
{
  "name": "@wescome/nlah",
  "version": "0.1.0",
  "description": "Natural-Language Agent Harness runtime for artifact-gated coding swarms.",
  "type": "module",
  "bin": {
    "nlah": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "run:mvp": "tsx src/cli.ts run --harness harnesses/coding_swarm.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "execa": "^9.0.0",
    "yaml": "^2.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

## `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

---

# WORK PACKET 001 — Implement typed errors

## Files

```text
src/errors.ts
```

## Goal

Create typed runtime errors.

## Required implementation

```ts
export class NlahError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NlahError";
    this.code = code;
  }
}

export class SchemaValidationError extends NlahError {
  constructor(message: string) {
    super("SCHEMA_VALIDATION_ERROR", message);
    this.name = "SchemaValidationError";
  }
}

export class CompilerError extends NlahError {
  constructor(message: string) {
    super("COMPILER_ERROR", message);
    this.name = "CompilerError";
  }
}

export class ArtifactError extends NlahError {
  constructor(message: string) {
    super("ARTIFACT_ERROR", message);
    this.name = "ArtifactError";
  }
}

export class GateError extends NlahError {
  constructor(message: string) {
    super("GATE_ERROR", message);
    this.name = "GateError";
  }
}

export class RuntimeError extends NlahError {
  constructor(message: string) {
    super("RUNTIME_ERROR", message);
    this.name = "RuntimeError";
  }
}
```

## Acceptance

```bash
pnpm typecheck
```

must pass.

---

# WORK PACKET 002 — Implement DSL schemas

## Files

```text
src/schema.ts
```

## Goal

Implement Zod schemas and exported TypeScript types for the NLAH DSL.

## Required implementation

```ts
import { z } from "zod";

export const HarnessMetadataSchema = z.object({
  name: z.string().min(1),
  task_family: z.string().min(1),
  objective: z.string().min(1)
});

export const RuntimeConfigSchema = z.object({
  max_patch_workers: z.number().int().nonnegative().default(1),
  max_repair_rounds: z.number().int().nonnegative().default(0),
  state_root: z.string().min(1),
  artifact_root: z.string().min(1)
});

export const RoleSpecSchema = z.object({
  responsibility: z.string().min(1)
});

export const ArtifactSpecSchema = z.object({
  path: z.string().min(1),
  required: z.boolean().default(true)
});

export const GateSpecSchema = z.object({
  all: z.array(z.unknown()).default([]),
  any: z.array(z.unknown()).default([])
});

export const StageSpecSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  role: z.string().min(1),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  gate: GateSpecSchema.optional()
});

export const HarnessSpecSchema = z.object({
  nlahspec: z.literal("0.1"),
  harness: HarnessMetadataSchema,
  runtime: RuntimeConfigSchema,
  roles: z.record(RoleSpecSchema),
  artifacts: z.record(ArtifactSpecSchema),
  stages: z.record(StageSpecSchema),
  failure_taxonomy: z.record(z.string()).optional()
});

export type HarnessMetadata = z.infer<typeof HarnessMetadataSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RoleSpec = z.infer<typeof RoleSpecSchema>;
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type GateSpec = z.infer<typeof GateSpecSchema>;
export type StageSpec = z.infer<typeof StageSpecSchema>;
export type HarnessSpec = z.infer<typeof HarnessSpecSchema>;
```

## Prohibitions

Do not:

```text
1. parse YAML here
2. access the filesystem here
3. implement compiler validation here
4. use any
```

## Acceptance tests

Create `test/schema.test.ts`.

Must test:

```text
1. valid harness parses
2. invalid version fails
3. missing harness metadata fails
4. missing role responsibility fails
5. stage defaults inputs and outputs
```

---

# WORK PACKET 003 — Implement state types

## Files

```text
src/state.ts
```

## Goal

Define runtime state and result types.

## Required implementation

```ts
import type { ArtifactStatus } from "./artifacts.js";
import type { TraceEvent } from "./trace.js";

export type RuntimeStatus = "PASS" | "FAIL" | "INCOMPLETE";

export type RuntimeState = {
  runId: string;
  currentState: string;

  taskPath: string;
  repoPath: string;
  harnessPath: string;

  runRoot: string;
  stateRoot: string;
  artifactRoot: string;

  stageHistory: TraceEvent[];
  artifacts: Record<string, ArtifactStatus>;

  lastError?: string;
};

export type RuntimeResult = {
  runId: string;
  status: RuntimeStatus;
  finalState: string;
  runRoot: string;
  artifactRoot: string;
  tracePath: string;
  message?: string;
};
```

## Acceptance

```bash
pnpm typecheck
```

must pass.

---

# WORK PACKET 004 — Implement graph model

## Files

```text
src/graph.ts
test/graph.test.ts
```

## Goal

Implement directed graph utilities for stage transitions.

## Required exports

```ts
import type { StageSpec } from "./schema.js";
import { CompilerError } from "./errors.js";

export type GraphEdge = {
  stageName: string;
  from: string;
  to: string;
};

export type StageGraph = {
  edges: GraphEdge[];
  states: Set<string>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
};
```

## Required functions

```ts
export function buildStageGraph(stages: Record<string, StageSpec>): StageGraph
```

```ts
export function findStartStates(graph: StageGraph): string[]
```

```ts
export function assertNoCycles(graph: StageGraph): void
```

```ts
export function assertReachableFrom(graph: StageGraph, startState: string): void
```

```ts
export function deterministicStageOrder(
  stages: Record<string, StageSpec>,
  startState: string
): string[]
```

## Rules

```text
1. Edge = one stage.
2. Graph states come from every stage.from and stage.to.
3. Start states are states with outgoing edges and no incoming edges.
4. v0 supports only acyclic graphs.
5. Cycle detection must fail with CompilerError.
6. Unreachable stages must fail with CompilerError.
7. Deterministic order must follow transitions from start state.
8. When multiple outgoing edges exist, sort by stage name.
```

## Acceptance tests

`test/graph.test.ts` must test:

```text
1. simple linear graph builds
2. start state is detected
3. deterministic order is stable
4. cycle throws CompilerError
5. unreachable stage throws CompilerError
```

---

# WORK PACKET 005 — Implement compiler

## Files

```text
src/compiler.ts
test/compiler.test.ts
```

## Goal

Load YAML, validate with Zod, perform semantic validation, compile to graph.

## Required exports

```ts
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

export type CompiledHarness = {
  spec: HarnessSpec;
  stagesByFromState: Record<string, Array<{ name: string; spec: StageSpec }>>;
  stageOrder: string[];
  startState: string;
  terminalStates: string[];
};
```

## Required functions

```ts
export async function loadHarness(filePath: string): Promise<HarnessSpec>
```

```ts
export function compileHarness(spec: HarnessSpec): CompiledHarness
```

## Semantic validations

Compiler must throw if:

```text
1. no stages exist
2. no roles exist
3. no artifacts exist
4. a stage references a missing role
5. a stage input references a missing artifact
6. a stage output references a missing artifact
7. an artifact path is absolute
8. runtime.state_root is absolute
9. runtime.artifact_root is absolute
10. there is not exactly one start state in v0
11. graph contains cycles
12. graph contains unreachable stages
```

## Stage grouping

`stagesByFromState` must be:

```ts
{
  "TaskReceived": [
    { name: "CONTRACT", spec: { ... } }
  ]
}
```

## Terminal states

Terminal states are graph states with incoming edges and no outgoing edges.

## Acceptance tests

`test/compiler.test.ts` must test:

```text
1. valid harness compiles
2. missing role fails
3. missing artifact output fails
4. absolute artifact path fails
5. multiple start states fail
6. stage order equals CONTRACT, MAP, PATCH, VERIFY, RELEASE for MVP harness
```

---

# WORK PACKET 006 — Implement artifact manager

## Files

```text
src/artifacts.ts
test/artifacts.test.ts
```

## Goal

Resolve and manage artifact files under the run root.

## Required exports

```ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessSpec } from "./schema.js";
import { ArtifactError } from "./errors.js";

export type ArtifactStatus = {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes?: number;
};
```

## Required class

```ts
export class ArtifactManager {
  constructor(runRoot: string, spec: HarnessSpec)

  resolve(name: string): string

  exists(name: string): Promise<boolean>

  readText(name: string): Promise<string>

  writeText(name: string, content: string): Promise<string>

  status(name: string): Promise<ArtifactStatus>

  allStatuses(): Promise<Record<string, ArtifactStatus>>
}
```

## Resolution rules

```text
1. Artifact name must exist in spec.artifacts.
2. Artifact path must be relative.
3. Artifact path resolves under runRoot.
4. If resolved path escapes runRoot, throw ArtifactError.
5. writeText must create parent directories.
```

## Acceptance tests

`test/artifacts.test.ts` must test:

```text
1. resolve known artifact
2. unknown artifact throws
3. writeText creates parent directories
4. exists returns true after write
5. status includes sizeBytes
6. path traversal is rejected
```

---

# WORK PACKET 007 — Implement shell adapter

## Files

```text
src/adapters.ts
```

## Goal

Provide safe deterministic command execution.

## Required exports

```ts
import { execa } from "execa";

export type AdapterResult = {
  ok: boolean;
  returncode: number;
  stdout: string;
  stderr: string;
};

export class ShellAdapter {
  async run(
    command: string[],
    cwd: string,
    timeoutSeconds = 120
  ): Promise<AdapterResult> {
    const result = await execa(command[0], command.slice(1), {
      cwd,
      timeout: timeoutSeconds * 1000,
      reject: false
    });

    return {
      ok: result.exitCode === 0,
      returncode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
```

## Prohibitions

Do not:

```text
1. use shell=true
2. accept command as a single string
3. silently throw away stderr
```

## Acceptance

```bash
pnpm typecheck
```

must pass.

---

# WORK PACKET 008 — Implement gates

## Files

```text
src/gates.ts
test/gates.test.ts
```

## Goal

Implement gate registry and gate evaluation.

## Required exports

```ts
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
```

## Required gates

Implement:

```text
exists
patch_applies_cleanly
repo_map_names_relevant_files
repo_map_names_test_entrypoints
verifier_accepts_patch
test_results_support_claims
final_patch_matches_verified_candidate
```

## Gate argument syntax

Harness supports:

```yaml
- exists: RepoMap
- patch_applies_cleanly: CandidatePatch
- verifier_accepts_patch
```

So implement parser:

```ts
export function parseGateExpression(expr: unknown): { gateName: string; args: unknown }
```

Rules:

```text
1. string gate means gateName = string, args = undefined
2. object gate must have exactly one key
3. anything else throws GateError
```

## Required functions

```ts
export async function evaluateGateExpression(
  expr: unknown,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult>
```

```ts
export async function evaluateGateSpec(
  gate: { all?: unknown[]; any?: unknown[] } | undefined,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<GateResult[]>
```

## Gate behavior

### `exists`

```text
Pass if named artifact exists and size > 0.
```

### `patch_applies_cleanly`

```text
Run git apply --check <artifact-path> inside state.repoPath.
Pass if exit code 0.
```

### `repo_map_names_relevant_files`

```text
Read RepoMap.
Pass if it contains heading "Relevant files" and at least one path-like token.
```

### `repo_map_names_test_entrypoints`

```text
Read RepoMap.
Pass if it contains "Relevant tests" or "Test entrypoints".
```

### `verifier_accepts_patch`

```text
Read VerifierReport.
Pass if it contains exact substring "Verdict: PASS".
```

### `test_results_support_claims`

```text
Read VerifierReport.
Pass if it contains "Tests run".
```

### `final_patch_matches_verified_candidate`

```text
Read FinalPatch and CandidatePatch.
Pass if contents are identical after trim().
```

## Acceptance tests

`test/gates.test.ts` must test:

```text
1. parse string gate
2. parse object gate
3. malformed object gate fails
4. exists passes for non-empty artifact
5. exists fails for missing artifact
6. verifier_accepts_patch passes only with Verdict: PASS
7. final_patch_matches_verified_candidate compares content
```

---

# WORK PACKET 009 — Implement trace logger

## Files

```text
src/trace.ts
test/trace.test.ts
```

## Goal

Write append-only JSONL runtime trace.

## Required exports

```ts
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export type TraceEvent = {
  timestamp: string;
  runId: string;
  event: string;
  stage?: string;
  fromState?: string;
  toState?: string;
  artifact?: string;
  gate?: string;
  passed?: boolean;
  message?: string;
};
```

## Required class

```ts
export class TraceLogger {
  constructor(
    private readonly ledgerPath: string,
    private readonly runId: string
  ) {}

  async emit(
    event: string,
    payload: Partial<Omit<TraceEvent, "timestamp" | "runId" | "event">> = {}
  ): Promise<void> {
    await mkdir(path.dirname(this.ledgerPath), { recursive: true });

    const traceEvent: TraceEvent = {
      timestamp: new Date().toISOString(),
      runId: this.runId,
      event,
      ...payload
    };

    await appendFile(this.ledgerPath, `${JSON.stringify(traceEvent)}\n`, "utf8");
  }

  get path(): string {
    return this.ledgerPath;
  }
}
```

## Required events

Runtime must emit:

```text
run_started
stage_started
artifact_created
gate_passed
gate_failed
state_transition
stage_completed
run_completed
run_failed
```

## Acceptance tests

`test/trace.test.ts` must test:

```text
1. emit creates JSONL file
2. each line parses as JSON
3. event includes timestamp
4. event includes runId
5. transition event can include fromState and toState
```

---

# WORK PACKET 010 — Implement deterministic role stubs

## Files

```text
src/runtime.ts
```

## Goal

Before LLMs exist, runtime needs deterministic stage handlers that produce expected artifacts.

## Required behavior

Implement internal function:

```ts
async function executeDeterministicStage(
  stageName: string,
  state: RuntimeState,
  artifacts: ArtifactManager
): Promise<string[]>
```

Return list of created artifact names.

## Stage behavior

Do not hardcode stage order, but v0 may map by role and declared outputs.

For every declared output artifact, write deterministic content.

Specific required content:

### `IssueContract`

```md
# Issue Contract

## Problem Summary

Fix the target repository task described in TASK.md.

## Acceptance Criteria

The patch must satisfy the task and pass verification.

## Non-Goals

No unrelated refactors.
```

### `RepoMap`

```md
# Repo Map

## Problem summary

The target task concerns the repository behavior described in TASK.md.

## Relevant files

- src/math.ts

## Relevant tests

- test/math.test.ts

## Suspected root cause

Implementation does not satisfy expected behavior.

## Blast-radius risks

Keep patch minimal.
```

### `CandidatePatch`

Must write a valid git patch for `examples/target_repo_stub` changing `return a - b;` to `return a + b;`.

Patch content:

```diff
diff --git a/src/math.ts b/src/math.ts
index 0000000..0000001 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,3 @@
 export function add(a: number, b: number): number {
-  return a - b;
+  return a + b;
 }
```

### `VerifierReport`

```md
# Verifier Report

## Patch Summary

The candidate patch changes add() to return the sum of its inputs.

## Tests run

- git apply --check candidate.patch

## Evidence

Patch applies cleanly.

## Verdict

Verdict: PASS
```

### `FinalPatch`

Must equal `CandidatePatch`.

### `PRSummary`

```md
# PR Summary

## Summary

Fix add() so it returns a + b.

## Files changed

- src/math.ts

## Tests run

- git apply --check candidate.patch

## Verification evidence

Verifier report returned Verdict: PASS.

## Residual risk

Minimal; single-line arithmetic fix.
```

## Acceptance

Runtime tests must confirm all files are produced.

---

# WORK PACKET 011 — Implement runtime

## Files

```text
src/runtime.ts
test/runtime.test.ts
```

## Goal

Execute compiled harness deterministically.

## Required exports

```ts
import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadHarness, compileHarness } from "./compiler.js";
import { ArtifactManager } from "./artifacts.js";
import { TraceLogger } from "./trace.js";
import { evaluateGateSpec } from "./gates.js";
import type { RuntimeResult, RuntimeState } from "./state.js";
import { RuntimeError } from "./errors.js";

export async function runHarness(
  harnessPath: string,
  repoPath: string,
  taskPath: string,
  runId = randomUUID()
): Promise<RuntimeResult>
```

## Runtime directory

Use:

```text
runs/<runId>/
```

Inside:

```text
runs/<runId>/TASK.md
runs/<runId>/state/task_history.jsonl
runs/<runId>/artifacts/
```

Ignore `state_root` and `artifact_root` from YAML for physical directory selection in v0 except for validation. Use the deterministic path above.

## Execution loop

```text
1. load harness
2. compile harness
3. create runRoot/state/artifacts directories
4. copy taskPath to runRoot/TASK.md
5. create ArtifactManager
6. create TraceLogger
7. initialize RuntimeState.currentState = compiled.startState
8. emit run_started
9. while currentState is not terminal:
   a. find stages for currentState
   b. if none, fail
   c. if more than one, choose alphabetically by stage name for v0
   d. emit stage_started
   e. executeDeterministicStage
   f. emit artifact_created for every created artifact
   g. check every declared output exists
   h. evaluate gates
   i. emit gate_passed or gate_failed
   j. if any required all-gate failed, emit run_failed and return FAIL
   k. transition state
   l. emit state_transition
   m. emit stage_completed
10. emit run_completed
11. return PASS
```

## Terminal states

Use `compiled.terminalStates`.

For MVP, expected final state:

```text
PullRequestReady
```

## RuntimeResult

On pass:

```ts
{
  runId,
  status: "PASS",
  finalState: "PullRequestReady",
  runRoot,
  artifactRoot,
  tracePath
}
```

On fail:

```ts
{
  runId,
  status: "FAIL",
  finalState: state.currentState,
  runRoot,
  artifactRoot,
  tracePath,
  message
}
```

## Acceptance tests

`test/runtime.test.ts` must test:

```text
1. MVP harness completes PASS
2. run directory is created
3. TASK.md is copied
4. all expected artifacts exist
5. trace ledger exists
6. trace includes run_started
7. trace includes stage_started
8. trace includes gate_passed
9. trace includes state_transition
10. trace includes run_completed
```

---

# WORK PACKET 012 — Implement CLI

## Files

```text
src/cli.ts
src/index.ts
```

## Goal

Expose command-line runtime.

## `src/index.ts`

Export:

```ts
export * from "./schema.js";
export * from "./compiler.js";
export * from "./graph.js";
export * from "./state.js";
export * from "./runtime.js";
export * from "./artifacts.js";
export * from "./gates.js";
export * from "./trace.js";
export * from "./adapters.js";
export * from "./errors.js";
```

## `src/cli.ts`

Implement Commander CLI:

```ts
#!/usr/bin/env node

import { Command } from "commander";
import { runHarness } from "./runtime.js";

const program = new Command();

program
  .name("nlah")
  .description("Natural-Language Agent Harness runtime")
  .version("0.1.0");

program
  .command("run")
  .requiredOption("--harness <path>")
  .requiredOption("--repo <path>")
  .requiredOption("--task <path>")
  .option("--run-id <id>")
  .action(async (opts) => {
    const result = await runHarness(
      opts.harness,
      opts.repo,
      opts.task,
      opts.runId
    );

    console.log(`Run ID: ${result.runId}`);
    console.log(`Status: ${result.status}`);
    console.log(`State: ${result.finalState}`);
    console.log(`Artifacts: ${result.artifactRoot}`);
    console.log(`Trace: ${result.tracePath}`);

    if (result.message) {
      console.log(`Message: ${result.message}`);
    }

    process.exitCode = result.status === "PASS" ? 0 : 1;
  });

await program.parseAsync(process.argv);
```

## Acceptance

This must work:

```bash
pnpm dev -- run --harness harnesses/coding_swarm.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md
```

And this must work:

```bash
pnpm run:mvp
```

---

# WORK PACKET 013 — Add MVP harness

## Files

```text
harnesses/coding_swarm.mvp.yaml
```

## Content

```yaml
nlahspec: "0.1"

harness:
  name: CODING_SWARM_MVP
  task_family: repository_issue_resolution
  objective: >
    Resolve a repository-grounded issue by producing a patch,
    independent verification, and a PR-ready summary.

runtime:
  max_patch_workers: 2
  max_repair_rounds: 1
  state_root: runs/current/state
  artifact_root: runs/current/artifacts

roles:
  Cartographer:
    responsibility: >
      Map relevant files, tests, dependencies, and likely blast radius.
      Must not edit files.

  PatchWorker:
    responsibility: >
      Produce one candidate patch from the issue contract and repo map.

  Verifier:
    responsibility: >
      Independently check the patch against the original issue,
      tests, and acceptance contract. Must not repair the patch.

  ReleaseAgent:
    responsibility: >
      Produce final.patch, evidence, and a PR-ready summary.

artifacts:
  IssueContract:
    path: artifacts/issue_contract.md
    required: true

  RepoMap:
    path: artifacts/repo_map.md
    required: true

  CandidatePatch:
    path: artifacts/candidate.patch
    required: true

  VerifierReport:
    path: artifacts/verifier_report.md
    required: true

  FinalPatch:
    path: artifacts/final.patch
    required: true

  PRSummary:
    path: artifacts/pr_summary.md
    required: true

stages:
  CONTRACT:
    from: TaskReceived
    to: IssueContracted
    role: Cartographer
    outputs: [IssueContract]
    gate:
      all:
        - exists: IssueContract

  MAP:
    from: IssueContracted
    to: RepoMapped
    role: Cartographer
    outputs: [RepoMap]
    gate:
      all:
        - exists: RepoMap
        - repo_map_names_relevant_files
        - repo_map_names_test_entrypoints

  PATCH:
    from: RepoMapped
    to: PatchCandidate
    role: PatchWorker
    outputs: [CandidatePatch]
    gate:
      all:
        - exists: CandidatePatch
        - patch_applies_cleanly: CandidatePatch

  VERIFY:
    from: PatchCandidate
    to: VerifiedPatch
    role: Verifier
    outputs: [VerifierReport]
    gate:
      all:
        - exists: VerifierReport
        - verifier_accepts_patch
        - test_results_support_claims

  RELEASE:
    from: VerifiedPatch
    to: PullRequestReady
    role: ReleaseAgent
    outputs: [FinalPatch, PRSummary]
    gate:
      all:
        - exists: FinalPatch
        - exists: PRSummary
        - final_patch_matches_verified_candidate

failure_taxonomy:
  missing_artifact: retry_stage
  patch_does_not_apply: return_to_PATCH
  verifier_rejects: return_to_PATCH
  budget_exceeded: release_incomplete
```

---

# WORK PACKET 014 — Add role files

## Files

```text
roles/cartographer.md
roles/patch_worker.md
roles/verifier.md
roles/release_agent.md
```

## `roles/cartographer.md`

```md
# Role: Cartographer

## Responsibility

Map the repository surface relevant to the task.

## Must produce

- issue_contract.md
- repo_map.md

## Must not

- edit source files
- produce patches
- claim verification

## Required repo_map.md sections

1. Problem summary
2. Relevant files
3. Relevant tests
4. Suspected root cause
5. Blast-radius risks
```

## `roles/patch_worker.md`

```md
# Role: PatchWorker

## Responsibility

Produce a candidate patch that addresses the issue contract.

## Must produce

- candidate.patch

## Must

- base changes on repo_map.md
- keep patch minimal
- preserve existing style
- avoid unrelated refactors
```

## `roles/verifier.md`

```md
# Role: Verifier

## Responsibility

Independently evaluate candidate.patch.

## Must produce

- verifier_report.md

## Required verdicts

- Verdict: PASS
- Verdict: FAIL
- Verdict: INCONCLUSIVE

## Must not

- edit source files
- repair patch
- silently ignore failed checks
```

## `roles/release_agent.md`

```md
# Role: ReleaseAgent

## Responsibility

Prepare final release artifacts.

## Must produce

- final.patch
- pr_summary.md

## Required pr_summary.md sections

1. Summary
2. Files changed
3. Tests run
4. Verification evidence
5. Residual risk
```

---

# WORK PACKET 015 — Add example target repo

## Files

```text
examples/TASK.md
examples/target_repo_stub/package.json
examples/target_repo_stub/tsconfig.json
examples/target_repo_stub/src/math.ts
examples/target_repo_stub/test/math.test.ts
```

## `examples/TASK.md`

````md
# Task

Fix `add(a, b)` so it returns the sum of `a` and `b`.

## Expected behavior

```ts
add(2, 3) === 5
````

## Current bug

The implementation subtracts instead of adding.

````

## `examples/target_repo_stub/package.json`

```json
{
  "name": "target-repo-stub",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
````

## `examples/target_repo_stub/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

## `examples/target_repo_stub/src/math.ts`

```ts
export function add(a: number, b: number): number {
  return a - b;
}
```

## `examples/target_repo_stub/test/math.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { add } from "../src/math.js";

describe("add", () => {
  it("returns the sum of two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

Important: initialize the target repo as a git repo during test setup or runtime setup before `git apply --check` is called.

Runtime test may do:

```bash
git init
git add .
git commit -m "initial target repo"
```

inside a temporary copy of `examples/target_repo_stub`.

---

# WORK PACKET 016 — Implement tests

## Files

```text
test/schema.test.ts
test/compiler.test.ts
test/graph.test.ts
test/artifacts.test.ts
test/gates.test.ts
test/trace.test.ts
test/runtime.test.ts
```

## Requirements

Tests must use temporary directories where runtime writes files.

Use Node:

```ts
import { mkdtemp, cp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
```

Do not let tests depend on existing `runs/`.

## Required command

This must pass:

```bash
pnpm test
pnpm typecheck
```

---

# WORK PACKET 017 — README

## Files

```text
README.md
```

## Required content

````md
# NLAH

Natural-Language Agent Harness runtime for artifact-gated coding swarms.

## What this is

NLAH is a TypeScript-first runtime for executing structured natural-language harnesses.

A harness defines:

- roles
- stages
- artifacts
- gates
- failure modes
- runtime state

The runtime executes the harness as a typed artifact-gated WorkGraph.

## MVP

The MVP runs a deterministic coding-swarm harness:

```bash
pnpm install
pnpm run:mvp
````

Expected output:

```text
Status: PASS
State: PullRequestReady
```

## Architecture

```text
YAML Harness
→ Zod Schema
→ Compiler
→ Stage Graph
→ Runtime
→ Artifacts
→ Gates
→ Trace Ledger
```

## v0 Scope

Included:

* YAML harness loading
* Zod validation
* graph compilation
* deterministic stage execution
* artifact manager
* gate evaluator
* JSONL trace ledger
* CLI

Not included yet:

* LLM calls
* LangGraph
* GitHub PR creation
* real multi-agent execution

````

---

# WORK PACKET 018 — Final acceptance

## Commands that must pass

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm run:mvp
````

## Required final output

`pnpm run:mvp` must print:

```text
Status: PASS
State: PullRequestReady
```

## Required generated files

After running, there must be a run directory:

```text
runs/<runId>/
├── TASK.md
├── state/
│   └── task_history.jsonl
└── artifacts/
    ├── issue_contract.md
    ├── repo_map.md
    ├── candidate.patch
    ├── verifier_report.md
    ├── final.patch
    └── pr_summary.md
```

## Required trace events

`task_history.jsonl` must contain at least one event of each type:

```text
run_started
stage_started
artifact_created
gate_passed
state_transition
stage_completed
run_completed
```

## Required status rule

Return `PASS` only if:

```text
1. final.patch exists
2. pr_summary.md exists
3. verifier_report.md contains Verdict: PASS
4. all declared gates passed
5. trace ledger exists
```

---

# Final instruction to coding agent

Implement the packets in numeric order.

Do not skip tests.

Do not introduce LLM calls.

Do not introduce LangGraph.

Do not introduce hidden orchestration logic.

The MVP is complete only when the DSL harness drives deterministic execution end to end.
