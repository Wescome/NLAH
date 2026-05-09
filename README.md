# NLAH

NLAH is a TypeScript-first Natural-Language Agent Harness runtime for artifact-gated crews.

It is not an LLM coding agent. It is a language workbench for making crew organization explicit: roles, stages, artifacts, workers, gates, state transitions, and trace records are represented as executable harness/runtime artifacts instead of hidden controller behavior.

A crew is a role-based execution unit made of stages, roles, artifacts, workers, gates, and traces. Coding is the first crew specialization in this repository, but the runtime is not limited to coding.

## Current v0 Status

The v0 runtime can execute the MVP crew harness end to end:

```text
Crew harness YAML
-> Zod schema
-> compiler
-> WorkGraph
-> crew runtime
-> worker adapter
-> artifact manager
-> gates
-> JSONL trace
-> summary.json
```

Current capabilities:

- YAML crew harness loading and typed Zod validation
- deterministic WorkGraph compilation and traversal
- artifact-gated stage completion
- executable gates, including `git apply --check`
- trace ledger at `runs/<run_id>/state/task_history.jsonl`
- machine-readable run summary at `runs/<run_id>/summary.json`
- CLI text output and JSON output
- pluggable worker adapter interface
- worker registry and stage worker binding support
- provider-neutral LLM worker interface with local mock demo only

## Install

```bash
pnpm install
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

## Run The Deterministic MVP

```bash
pnpm run:mvp
```

Equivalent direct CLI command:

```bash
pnpm tsx src/cli.ts run --harness harnesses/crew.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md
```

Expected status:

```text
Status: PASS
State: PullRequestReady
```

The legacy harness path remains available for compatibility:

```bash
pnpm run:legacy-coding-swarm
```

## Script Worker Demo

The script worker demo runs the same MVP crew harness through `ScriptWorkerAdapter` and `WorkerRegistry` without changing runtime code:

```bash
pnpm run:script-demo
```

## Mock LLM Demo

The mock LLM demo runs the same MVP crew harness through `LlmWorkerAdapter` with a fake local provider only. It makes no external API calls:

```bash
pnpm run:mock-llm-demo
```

## Local CLI Demo

The local CLI demo runs the same MVP crew harness through `LocalCliCodingWorkerAdapter` and local Node commands:

```bash
pnpm run:local-cli-demo
```

## CLI JSON Output

Automation and CI callers can request a single JSON object on stdout:

```bash
pnpm tsx src/cli.ts run --harness harnesses/crew.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md --json
```

## CLI Worker Selection

The CLI currently exposes deterministic worker selection:

```bash
pnpm tsx src/cli.ts run --harness harnesses/crew.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md --worker deterministic
```

Unsupported CLI worker names fail before runtime execution with `unsupported CLI worker: <name>`.

## Supported Workers

`deterministic`: default worker used by `pnpm run:mvp`. It writes deterministic MVP artifacts for the math fixture.

`CommandWorkerAdapter`: in-process adapter API that dispatches stage names to registered TypeScript handler functions.

`ScriptWorkerAdapter`: controlled local-script adapter API that executes stage-specific `string[]` commands through `ShellAdapter`. It does not use `shell=true`.

`LlmWorkerAdapter`: provider-neutral interface that accepts an injected provider. The repository includes only a fake local provider demo.

`AiderCliWorkerAdapter`: external coding-tool adapter for PATCH-stage experiments. Aider is not a package dependency, automated tests use a fake shell, and the adapter does not commit or push. See [docs/aider_worker.md](docs/aider_worker.md).

Manual Aider demo runs are guarded because they invoke real local Aider:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

## Not Yet Implemented

- external LLM provider integrations
- LangGraph integration
- GitHub PR automation
- cloud execution
