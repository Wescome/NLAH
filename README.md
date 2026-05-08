# NLAH

NLAH is a TypeScript-first Natural-Language Agent Harness runtime for artifact-gated coding swarms.

It is not an LLM coding agent. It is a small language workbench for making the organization around coding agents explicit: roles, stages, artifacts, gates, state transitions, worker bindings, and trace records are represented as executable harness/runtime artifacts instead of hidden controller behavior.

## Current v0 Status

The v0 runtime can execute the MVP coding swarm harness end to end:

```text
Harness YAML
-> Zod schema
-> compiler
-> WorkGraph
-> stage runtime
-> worker adapter
-> artifact manager
-> gates
-> JSONL trace
-> summary.json
```

Current capabilities:

- YAML harness loading and typed Zod validation
- deterministic WorkGraph compilation and traversal
- artifact-gated stage completion
- executable gates, including `git apply --check`
- trace ledger at `runs/<run_id>/state/task_history.jsonl`
- machine-readable run summary at `runs/<run_id>/summary.json`
- CLI text output and JSON output
- pluggable worker adapter interface
- worker registry and stage worker binding support

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
```

## Run The Deterministic MVP

```bash
pnpm run:mvp
```

Equivalent direct CLI command:

```bash
pnpm tsx src/cli.ts run --harness harnesses/coding_swarm.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md
```

Expected status:

```text
Status: PASS
State: PullRequestReady
```

## Script Worker Demo

The script worker demo runs the same MVP harness through `ScriptWorkerAdapter` and `WorkerRegistry` without changing runtime code:

```bash
pnpm run:script-demo
```

## CLI JSON Output

Automation and CI callers can request a single JSON object on stdout:

```bash
pnpm tsx src/cli.ts run --harness harnesses/coding_swarm.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md --json
```

## CLI Worker Selection

The CLI currently exposes deterministic worker selection:

```bash
pnpm tsx src/cli.ts run --harness harnesses/coding_swarm.mvp.yaml --repo examples/target_repo_stub --task examples/TASK.md --worker deterministic
```

Unsupported CLI worker names fail before runtime execution with `unsupported CLI worker: <name>`.

## Supported Workers

`deterministic`: default worker used by `pnpm run:mvp`. It writes deterministic MVP artifacts for the math fixture.

`CommandWorkerAdapter`: in-process adapter API that dispatches stage names to registered TypeScript handler functions.

`ScriptWorkerAdapter`: controlled local-script adapter API that executes stage-specific `string[]` commands through `ShellAdapter`. It does not use `shell=true`.

## Not Yet Implemented

- LLM workers
- LangGraph integration
- GitHub PR automation
- cloud execution
