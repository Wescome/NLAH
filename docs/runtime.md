# Crew Runtime

The NLAH runtime executes a compiled crew harness as an artifact-gated WorkGraph. A crew is a role-based execution unit made of stages, roles, artifacts, workers, gates, and traces. Coding is currently the first crew specialization, but the runtime is not limited to coding.

A stage is complete only after its worker returns declared artifacts, those artifacts exist on disk, and the stage gates pass.

## `runHarness`

```ts
runHarness(
  harnessPath: string,
  repoPath: string,
  taskPath: string,
  runIdOrOptions?: string | RunHarnessOptions,
  workerAdapter?: WorkerAdapter
): Promise<RuntimeResult>
```

The runtime:

- loads and compiles the crew harness
- creates `runs/<run_id>/`
- copies the task file into the run directory
- initializes `ArtifactManager`
- initializes `TraceLogger`
- builds `StageContext` for each stage
- executes a worker adapter
- validates the worker artifact contract
- checks artifact existence and size
- evaluates gates
- writes trace events
- writes `summary.json`

## `RunHarnessOptions`

```ts
export type RunHarnessOptions = {
  runId?: string;
  workerAdapter?: WorkerAdapter;
  workerRegistry?: WorkerRegistry;
  overwriteRun?: boolean;
};
```

Compatibility is preserved for the older call style:

```ts
runHarness(harnessPath, repoPath, taskPath, runId, workerAdapter)
```

If `workerAdapter` is provided, it runs every stage. If `workerRegistry` is provided, the runtime uses `stage.spec.worker` when present, otherwise the registry default. If neither is provided, the runtime uses `DeterministicWorkerAdapter`.

By default, the runtime refuses to reuse an existing `runs/<runId>` directory and returns a `FAIL` result with a summary and trace when possible. Set `overwriteRun: true`, or pass `--overwrite-run` to `nlah run`, to remove the existing run directory before starting.

## `WorkerRegistry`

`WorkerRegistry` resolves named `WorkerAdapter` instances:

- includes `deterministic` by default
- supports custom registrations
- supports a configurable default worker
- throws `RuntimeError` for unknown workers

The CLI currently supports `--worker deterministic`. Programmatic callers can register command, script, or provider-neutral LLM workers directly.

`LocalCliCodingWorkerAdapter` is a generic local command adapter for coding CLIs such as Aider, Codex CLI, Claude Code, OpenHands CLI, or custom local tools. It executes one configured `string[]` command per stage through `ShellAdapter`, receives the same `StageContext` as other workers, and reports declared outputs back to the runtime artifact contract.

`pnpm run:local-cli-demo` runs the full MVP crew harness through `LocalCliCodingWorkerAdapter` with local Node commands. It is a runtime wiring demo and does not add any external coding tool dependency.

`AiderCliWorkerAdapter` is the first external-tool worker adapter. It writes a stage prompt under `runs/<runId>/worker_prompts/<stageName>.md`, invokes a configured Aider command through `ShellAdapter`, captures a non-empty git diff, and writes `CandidatePatch`. The v1 adapter supports `CandidatePatch` output only and does not add Aider as a package dependency.

## `WorkerAdapter`

```ts
export interface WorkerAdapter {
  execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput>;
}
```

Workers receive structured stage input and write declared artifacts through `ArtifactManager` or through resolved paths from `StageContext`.

The runtime validates `WorkerOutput.createdArtifacts`:

- returning an undeclared artifact fails the run
- omitting a declared output fails the run
- reporting a declared artifact without writing a non-empty file fails the run

## LLM Worker Interface Stub

`LlmWorkerAdapter` defines a provider-neutral worker boundary without integrating a provider. It accepts an `LlmProvider` with a single `complete(request)` method, builds a request from `StageContext`, writes returned artifact content through `ArtifactManager`, and returns the created artifact names.

No OpenAI, Anthropic, Codex, Claude, LangGraph, or external API calls are implemented in this adapter.

`pnpm run:mock-llm-demo` runs the full MVP crew harness through `LlmWorkerAdapter` with a fake local provider only. It is a runtime wiring demo and makes no external calls.

## `StageContext`

`StageContext` is the structured execution packet passed to workers:

```ts
export type StageContext = {
  taskText: string;
  roleText?: string;
  inputArtifacts: Record<string, string>;
  outputArtifactPaths: Record<string, string>;
};
```

It includes task text, role policy text when available, declared input artifact contents, and resolved paths for declared output artifacts. Output artifacts are not read during context construction.

## `ArtifactManager`

`ArtifactManager` resolves, reads, writes, and reports statuses for harness artifacts under the current run root. Artifact paths must be relative in the harness.

Important APIs:

- `resolve(name)`
- `exists(name)`
- `readText(name)`
- `writeText(name, content)`
- `status(name)`
- `allStatuses()`

## Gates

Gates enforce executable contracts after worker execution and artifact checks. Current gates include:

- `exists`
- `patch_applies_cleanly`
- `repo_map_names_relevant_files`
- `repo_map_names_test_entrypoints`
- `verifier_accepts_patch`
- `test_results_support_claims`
- `final_patch_matches_verified_candidate`

`patch_applies_cleanly` runs `git apply --check` through `ShellAdapter` with a `string[]` command, never `shell=true`.

## Trace Events

A successful stage-run sequence includes:

```text
run_started
stage_started
worker_completed
artifact_created
gate_passed
state_transition
stage_completed
run_completed
```

`worker_completed` is emitted after worker execution succeeds and the worker artifact contract passes, before `artifact_created` and gate events.

If worker execution fails, the runtime emits `run_failed` and does not emit `worker_completed` for that failed stage.

The trace ledger is written to:

```text
runs/<run_id>/state/task_history.jsonl
```

## `summary.json`

Every run writes:

```text
runs/<run_id>/summary.json
```

The summary is written for both `PASS` and `FAIL` and includes:

- `runId`
- `status`
- `finalState`
- `runRoot`
- `artifactRoot`
- `tracePath`
- `message` on failure when available
- all artifact statuses
