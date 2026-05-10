# Pi CLI Worker

## Purpose

`PiCliWorkerAdapter` integrates Pi as a NLAH worker substrate.

Pi is a terminal coding harness that can execute local coding work behind the NLAH worker contract. The adapter is designed to let Pi produce repository changes while NLAH captures artifacts, evaluates gates, records traces, and writes summaries.

## Positioning

NLAH remains the crew runtime.

Pi is a terminal coding harness worker. Pi must not own crew semantics, stage graph construction, artifact contracts, gate evaluation, trace records, or summaries.

The boundary is:

```text
NLAH Crew Runtime
-> WorkerInput + StageContext
-> PiCliWorkerAdapter
-> local Pi command
-> repo changes / command output
-> CandidatePatch artifact
-> NLAH gates and trace
```

## Why Pi Fits

Pi fits the NLAH worker model because it is:

- a minimal terminal coding harness
- customizable with extensions, skills, prompt templates, and packages
- available through interactive, print/JSON, RPC, and SDK modes
- flexible across providers and models
- built around context engineering support through `AGENTS.md`, `SYSTEM.md`, compaction, skills, prompt templates, and dynamic context

Those features make Pi a useful execution substrate while leaving orchestration semantics in NLAH.

## v1 Scope

The v1 adapter scope is intentionally narrow:

- CLI only
- print/json mode only
- `CandidatePatch` only
- fake-shell tests only
- no package dependency
- no real Pi invocation in CI

The adapter supports PATCH-stage experiments first. Other stages can remain deterministic, command-backed, script-backed, local-CLI-backed, or mock-backed until Pi behavior is proven at the worker boundary.

## Command Shape

Print mode:

```text
pi -p <promptPath>
```

JSON mode:

```text
pi -p <promptPath> --mode json
```

Extra args are appended to the configured command array. Commands are executed through `ShellAdapter` with `cwd = repoPath`.

## Artifact Flow

Pi edits repo files.

NLAH captures `git diff`.

NLAH writes `CandidatePatch`.

NLAH gates verify patch application and release correctness.

The adapter does not treat Pi stdout or model text as proof of completion. Stage completion still requires declared artifacts and passing gates.

## Safety

The adapter preserves the current worker safety model:

- no `shell=true`
- command arrays only
- no commit/push
- no destructive git operations
- timeout required
- optional env support
- NLAH remains responsible for gates and trace

Real Pi execution is optional and should be guarded in any future demo script. Automated tests must use fake-shell execution and must not require Pi to be installed.

## Future

Later integration paths:

- `PiRpcWorkerAdapter`
- `PiSdkWorkerAdapter`
- NLAH-specific Pi extension package
- Pi package containing NLAH skills/prompts

These should remain optional worker layers. The crew harness, runtime state machine, artifact manager, gates, trace ledger, and summary writer stay in NLAH.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```
