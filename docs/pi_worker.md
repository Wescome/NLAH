# Pi Worker Design v1

## Positioning

NLAH remains the crew runtime and control plane.

Pi is a terminal coding harness substrate. It can execute coding work, but it must not own NLAH crew semantics, stage graph construction, artifact contracts, gate evaluation, trace records, or run summaries.

The boundary should remain:

```text
NLAH crew runtime
-> WorkerInput + StageContext
-> Pi worker adapter
-> local Pi execution
-> declared artifacts
-> NLAH gates, trace, and summary
```

## Why Pi Fits

Pi is a strong candidate worker substrate because it is a minimal terminal coding harness with multiple integration surfaces.

Relevant fit:

- minimal terminal coding harness
- customizable extensions, skills, prompt templates, and packages
- four modes: interactive, print/JSON, RPC, SDK
- provider and model flexibility
- context engineering through `AGENTS.md`, `SYSTEM.md`, compaction, skills, and dynamic context

Those properties align with NLAH's worker model. NLAH can provide the structured stage packet and artifact contract, while Pi handles local coding-tool execution under that contract.

## First Integration Path

Start with `PiCliWorkerAdapter`.

Reasons:

- fastest fit with the existing `ShellAdapter`
- works with fake-shell tests
- can use print/JSON mode for non-interactive execution
- no Pi dependency required in this repository
- consistent with the existing Aider adapter pattern

The first implementation should be PATCH-only, matching the current external-tool adapter shape. Other stages can remain deterministic, command-backed, script-backed, or mock-backed until Pi behavior is proven at the worker boundary.

## Later Integration Paths

After the CLI adapter is stable, later paths can add deeper integration:

- `PiRpcWorkerAdapter`
- `PiSdkWorkerAdapter`
- `PiExtensionPackage` for NLAH-specific crew execution

These should remain optional layers. The crew harness, runtime state machine, artifact manager, gates, trace ledger, and summary writer stay in NLAH.

## Proposed `PiCliWorkerAdapter` Behavior

For v1, `PiCliWorkerAdapter` should:

1. Receive `WorkerInput`.
2. Write a stage prompt under `runs/<runId>/worker_prompts/<stageName>.md`.
3. Invoke the configured Pi command through `ShellAdapter`.
4. Support print/JSON mode for non-interactive execution.
5. Capture `git diff` after Pi exits.
6. Write `CandidatePatch` for PATCH v1.
7. Return declared artifact names in `WorkerOutput.createdArtifacts`.
8. Let NLAH artifact validation and gates decide whether the stage completed.

The adapter must not treat Pi stdout or model text as proof of completion. Completion still requires declared artifacts and passing gates.

## Config Sketch

```ts
export type PiCliWorkerConfig = {
  command?: string; // default "pi"
  mode?: "print" | "json";
  extraArgs?: string[];
  timeoutSeconds?: number;
  diffCommand?: string[];
};
```

Expected defaults:

- `command`: `"pi"`
- `mode`: `"json"` if the local Pi command supports it cleanly, otherwise `"print"`
- `timeoutSeconds`: explicit finite default
- `diffCommand`: `["git", "diff", "--", "src"]`

## Safety

The adapter must preserve the current worker safety model:

- no `shell=true`
- command arrays only
- no commit or push by default
- timeout required
- fake-shell tests only for CI
- real Pi run optional and guarded

The adapter should reject destructive git commands in configured command arrays and diff commands. Generated prompts should be stored under the run directory for auditability.

## Test Plan

The first implementation should not invoke real Pi in tests.

Tests should verify:

- prompt file is written
- prompt includes task text, role text, input artifacts, and declared outputs
- command array includes the configured Pi command and mode
- fake shell receives cwd as `repoPath`
- diff command runs after Pi command
- non-empty diff writes `CandidatePatch`
- empty diff fails
- failed Pi command fails
- failed diff command fails
- unsupported declared outputs fail for PATCH v1

## Next Implementation Packet

```text
feat: add pi cli worker adapter
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```
