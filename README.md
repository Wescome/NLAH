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

Release notes:

- [NLAH v0.1.0 — Crew Runtime Foundation](docs/release_v0_1_0.md)
- [NLAH v0.1.1 — Worker Adapter Documentation and Aider Path](docs/release_v0_1_1.md)
- [NLAH v0.1.2 — Pi CLI Worker Path](docs/release_v0_1_2.md)
- [Loom CLI Worker](docs/loom_worker.md)

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

Worker adapter matrix: [docs/worker_adapters.md](docs/worker_adapters.md).

`deterministic`: default worker used by `pnpm run:mvp`. It writes deterministic MVP artifacts for the math fixture.

`CommandWorkerAdapter`: in-process adapter API that dispatches stage names to registered TypeScript handler functions.

`ScriptWorkerAdapter`: controlled local-script adapter API that executes stage-specific `string[]` commands through `ShellAdapter`. It does not use `shell=true`.

`LlmWorkerAdapter`: provider-neutral interface that accepts an injected provider. The repository includes only a fake local provider demo.

`AiderCliWorkerAdapter`: external coding-tool adapter for PATCH-stage experiments. Aider is not a package dependency, automated tests use a fake shell, and the adapter does not commit or push. See [docs/aider_worker.md](docs/aider_worker.md).

`PiCliWorkerAdapter`: CLI worker for Pi text/JSON print mode using `@file` prompt arguments. Tests use a fake shell; Pi is not a package dependency and is not invoked by tests. The guarded manual PATCH demo uses JSON print mode and writes Pi debug artifacts under `runs/<runId>/debug/` on command or diff-capture failure. See [docs/pi_worker.md](docs/pi_worker.md).

`LoomCliWorkerAdapter`: preferred NLAH name for a domain-aware CLI worker built on the Pi command substrate. It adds domain prompt sections, fake-shell tests, a PATCH runtime demo, and Loom-named debug artifacts. See [docs/loom_worker.md](docs/loom_worker.md).

The optional Pi PATCH demo wires Pi into the PATCH stage while deterministic workers handle the other stages:

```bash
NLAH_RUN_REAL_PI=1 pnpm run:pi-patch-demo
```

Manual use requires Pi to be installed separately and verified with `pi --version`. Without `NLAH_RUN_REAL_PI=1`, the script refuses to run. Automated verification does not require real Pi.

The preferred Loom-named PATCH demo uses the same guarded/manual model:

```bash
NLAH_RUN_REAL_LOOM=1 pnpm run:loom-patch-demo
```

Manual Aider demo runs are guarded because they invoke real local Aider. Aider is not installed by this repo; install and verify it manually first:

```bash
python -m pip install aider-chat
aider --version
```

Then opt in to the real demo:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

The demo passes `--yes`, `--no-auto-commits`, `--no-gitignore`, `--map-tokens 0`, and `--no-restore-chat-history` to avoid confirmations, commits, non-interactive gitignore prompts, repo-map context, and restored chat history. It also runs Aider with UTF-8 Python and locale environment variables. Its Aider worker timeout is 120 seconds. A captured local Aider/LiteLLM/OpenAI encoding failure is documented in [docs/known_external_failures.md](docs/known_external_failures.md); fake-shell tests are the supported CI path.

## Not Yet Implemented

- external LLM provider integrations
- LangGraph integration
- GitHub PR automation
- cloud execution
