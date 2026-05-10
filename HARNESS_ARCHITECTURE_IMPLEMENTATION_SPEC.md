# NLAH Harness Architecture Implementation Spec

## Mission

Evolve NLAH from a linear artifact-gated MVP into a domain-neutral harness
kernel.

The harness is the product. Workers, CLIs, models, coding tools, and domain
specializations are substrates behind the harness boundary. A coding agent
implementing this spec must focus on harness semantics only:

```text
HarnessSpec
-> typed semantic model
-> StageGraph
-> role-bounded execution
-> artifact contracts
-> gate contracts
-> failure transitions
-> provenance trace
-> resumable run summary
```

## Non-Goals

Do not implement a new coding worker.
Do not add external LLM/provider integrations.
Do not add cloud execution.
Do not add GitHub pull request automation.
Do not make the harness depend on patch, repository, PR, or code-review terms.
Do not treat natural-language worker output as proof of stage completion.

## Architectural Invariants

1. Harness YAML drives execution.
2. Runtime code must not hardcode business or domain stage names.
3. A stage completes only when declared output artifacts satisfy their contracts.
4. A state transition occurs only when declared gate contracts pass.
5. Every failed gate emits a typed failure class.
6. Every failure class resolves through explicit harness failure semantics.
7. Every artifact records producer stage, role, worker, inputs, and gate evidence.
8. Role permissions are first-class harness data, not only markdown prose.
9. Graph semantics are explicit: linear, branch, join, retry, and loop are not inferred.
10. Trace records are causal provenance, not just event logs.

## Target Harness Model

Add a new `nlahspec: "0.2"` model while preserving `0.1` loading.

```yaml
nlahspec: "0.2"

harness:
  name: CREW_MVP
  objective: Resolve a task through artifact-gated crew execution.
  task_family: generic_task_resolution

runtime_policy:
  graph_mode: linear
  max_retries_per_stage: 1
  max_total_retries: 3
  default_failure_action: abort
  resume: false

roles:
  Cartographer:
    responsibility: Map the task surface.
    reads: [Task]
    writes: [IssueContract, RepoMap]
    must_not:
      - modify_workspace
      - claim_verification

artifacts:
  IssueContract:
    path: artifacts/issue_contract.md
    required: true
    contract:
      kind: markdown
      required_sections:
        - Problem Summary
        - Acceptance Criteria
        - Non-Goals

stages:
  CONTRACT:
    from: TaskReceived
    to: IssueContracted
    role: Cartographer
    inputs: []
    outputs: [IssueContract]
    gates:
      all:
        - id: issue_contract_exists
          uses: artifact_exists
          reads: [IssueContract]
          proves: issue_contract_materialized
          on_fail: missing_artifact
        - id: issue_contract_shape
          uses: artifact_contract_satisfied
          reads: [IssueContract]
          proves: issue_contract_has_required_sections
          on_fail: invalid_artifact
    on_failure:
      missing_artifact: retry_stage
      invalid_artifact: retry_stage

failure_taxonomy:
  missing_artifact:
    description: A declared output was absent or empty.
    default_action: retry_stage
  invalid_artifact:
    description: Artifact existed but failed its declared contract.
    default_action: retry_stage
  verification_failed:
    description: Gate evidence rejected the stage output.
    default_action: abort
  budget_exceeded:
    description: Retry or execution budget was exhausted.
    default_action: abort
```

## Work Packet 001 - Fix Gate Group Semantics

### Problem

Current `any` gate behavior records individual failed `any` members and the
runtime fails the run on the first failed gate result. That makes `any` behave
like `all`.

### Required Behavior

- `all`: every member must pass.
- `any`: at least one member must pass.
- Failed members inside a passing `any` group must be traceable but must not
  fail the stage.
- If no `any` member passes, emit one failed group result with the configured
  failure class.

### Acceptance Tests

- `all` with one failed member fails.
- `any` with one pass and one fail passes.
- `any` with all failed members fails.
- Runtime stage with passing `any` advances state.
- Runtime trace preserves member results without treating them as stage failure.

## Work Packet 002 - Add Artifact Contracts

### Goal

Make artifact validity a harness-level concept.

### Schema

```ts
type ArtifactContract =
  | {
      kind: "markdown";
      required_sections?: string[];
      required_patterns?: string[];
    }
  | {
      kind: "json";
      required_fields?: string[];
    }
  | {
      kind: "text";
      non_empty?: boolean;
      required_patterns?: string[];
    };
```

### Required Behavior

- Artifact paths remain relative and resolved under run root.
- A required artifact must exist and be non-empty.
- `artifact_contract_satisfied` evaluates the artifact's declared contract.
- Contract failures emit `invalid_artifact`.

### Acceptance Tests

- Markdown artifact missing a required section fails.
- Markdown artifact with all required sections passes.
- JSON artifact with malformed JSON fails.
- JSON artifact missing required fields fails.
- Text artifact with required pattern passes/fails deterministically.

## Work Packet 003 - Make Role Contracts First-Class

### Goal

Move enforceable role policy from markdown-only prose into harness data.

### Schema

```ts
type RoleContract = {
  responsibility: string;
  reads?: string[];
  writes?: string[];
  must_not?: string[];
};
```

### Required Behavior

- A stage may only consume artifacts allowed by its role `reads`, unless the
  role omits `reads`.
- A stage may only produce artifacts allowed by its role `writes`, unless the
  role omits `writes`.
- `must_not` is surfaced in `StageContext` for workers and trace metadata.
- Role markdown may remain as human-facing policy, but harness data is primary.

### Acceptance Tests

- Stage input outside role `reads` fails compile.
- Stage output outside role `writes` fails compile.
- `must_not` entries appear in worker context.
- Existing `0.1` harnesses still compile.

## Work Packet 004 - Type Gate Contracts

### Goal

Replace unstructured gate expressions with typed gate contracts while keeping
legacy gate syntax loadable.

### Schema

```ts
type GateContract = {
  id: string;
  uses: string;
  reads?: string[];
  proves: string;
  on_fail: string;
  args?: unknown;
};
```

### Required Behavior

- `uses` resolves to a gate implementation.
- `reads` must reference declared artifacts.
- `on_fail` must reference a failure taxonomy entry.
- Gate results include `id`, `uses`, `proves`, `on_fail`, `passed`, and
  optional message.
- Legacy `"exists"` and `{ exists: ArtifactName }` syntax is normalized into
  `GateContract` internally.

### Acceptance Tests

- Missing gate implementation fails compile or validation.
- Missing artifact in `reads` fails compile.
- Unknown `on_fail` class fails compile.
- Legacy gates normalize to typed gate contracts.
- Trace records typed gate fields.

## Work Packet 005 - Make Failure Semantics Executable

### Goal

Make `failure_taxonomy` operational instead of descriptive.

### Failure Actions

```ts
type FailureAction =
  | "abort"
  | "retry_stage"
  | "return_to_stage"
  | "transition_to_state"
  | "mark_incomplete";
```

### Required Behavior

- On gate failure, runtime resolves the gate's failure class.
- Stage-level `on_failure` overrides taxonomy default.
- Retry counters are persisted in runtime state and summary.
- Budget exhaustion emits `budget_exceeded`.
- Unsupported actions fail validation.

### Acceptance Tests

- Failed gate with `retry_stage` retries the same stage once.
- Failed gate with `abort` stops run.
- Failed gate with `return_to_stage` moves to configured stage/state.
- Retry budget exhaustion stops with `budget_exceeded`.
- Summary includes failure class, action taken, and retry counters.

## Work Packet 006 - Define Graph Semantics

### Goal

Stop implying graph behavior that runtime does not implement.

### Required Behavior

For `graph_mode: linear`:

- exactly one start state
- exactly one terminal state
- no state may have more than one outgoing stage
- no state may have more than one incoming stage, except the start state has none
- cycles are rejected

For future `graph_mode: dag`:

- branching and joins require explicit join policy
- parallelism requires explicit scheduling policy
- loops require explicit retry or loop policy

Only implement `linear` now unless separately approved.

### Acceptance Tests

- Two outgoing stages from one state fail in linear mode.
- Two incoming stages to one state fail in linear mode.
- Multiple terminals fail in linear mode.
- Existing MVP harness passes as linear.

## Work Packet 007 - Upgrade Trace To Provenance

### Goal

Trace must explain why every state transition happened.

### Required Event Payloads

`stage_started`:

- stage
- role
- worker
- fromState
- toState
- inputArtifacts
- outputArtifacts

`artifact_created`:

- artifact
- path
- producerStage
- producerRole
- worker
- inputArtifacts

`gate_passed` / `gate_failed`:

- gateId
- uses
- reads
- proves
- failureClass on failure
- message

`state_transition`:

- fromState
- toState
- stage
- passedGateIds
- producedArtifacts

`run_failed`:

- failureClass
- action
- failedStage
- failedGateId
- retryCounters

### Acceptance Tests

- Trace can reconstruct artifact lineage.
- Trace can reconstruct why each transition occurred.
- Failed run trace includes failure class and action.
- Summary links to trace and includes terminal provenance snapshot.

## Work Packet 008 - Add Harness Manifest Output

### Goal

Expose the compiled harness as a static, reviewable contract.

### Required Manifest Fields

- harness identity
- runtime policy
- graph mode
- stages in execution order
- roles and permissions
- artifacts and contracts
- gate contracts
- failure taxonomy
- unsupported or legacy syntax warnings

### Acceptance Tests

- Manifest includes role read/write/must_not policy.
- Manifest includes artifact contracts.
- Manifest includes normalized gate contracts.
- Manifest flags legacy `0.1` syntax as compatibility-normalized.

## Work Packet 009 - Migration Policy

### Required Compatibility

- Existing `nlahspec: "0.1"` harnesses continue to load.
- `0.1` harnesses are normalized into internal `0.2` semantic model.
- Runtime executes only the normalized model.
- CLI validate reports compatibility warnings for `0.1`.

### Acceptance Tests

- `harnesses/crew.mvp.yaml` still validates.
- `harnesses/coding_swarm.mvp.yaml` still validates.
- Manifest for `0.1` harness shows normalized `0.2` structure.
- No behavior regression in current deterministic MVP run.

## Required Verification

Run after each completed packet:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
```

Run before final handoff:

```bash
pnpm verify
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```

Optional external-tool demos remain manual and guarded. They are not required
for harness-kernel correctness.

## Implementation Order

1. Fix gate group semantics.
2. Add normalized internal harness model.
3. Add artifact contracts.
4. Add role contracts.
5. Add typed gate contracts.
6. Make failure taxonomy executable.
7. Enforce explicit linear graph semantics.
8. Upgrade trace provenance.
9. Expand manifest output.
10. Keep `0.1` compatibility through normalization.

This order protects the core harness invariant: execution is controlled by the
harness contract, not by worker behavior.
