# NLAH v0.1.1 — Worker Adapter Documentation and Aider Path

## Release Notes

This release documents and validates the post-v0.1.0 worker adapter additions. It does not move the `v0.1.0` tag.

## Additions Since v0.1.0

- worker adapter matrix
- Aider CLI worker design
- `AiderCliWorkerAdapter`
- Aider PATCH runtime demo
- manual Aider guard
- fake-shell test strategy

## Worker Adapter Matrix

`docs/worker_adapters.md` documents the current worker adapter set:

- `DeterministicWorkerAdapter`
- `CommandWorkerAdapter`
- `ScriptWorkerAdapter`
- `LocalCliCodingWorkerAdapter`
- `LlmWorkerAdapter`
- `AiderCliWorkerAdapter`

The matrix explains each adapter's purpose, external dependency requirements, `StageContext` usage, artifact-writing behavior, best use case, and current limitations.

## Aider CLI Worker Design

`docs/aider_worker.md` defines Aider as a worker substrate only. NLAH remains responsible for crew semantics, stage graph execution, artifacts, gates, traces, and summaries.

The design keeps Aider outside the core runtime and uses the same worker adapter contract as every other execution substrate.

## AiderCliWorkerAdapter

`AiderCliWorkerAdapter` is the first external coding-tool specialization.

Current behavior:

- writes a stage prompt under `runs/<runId>/worker_prompts/<stageName>.md`
- invokes a configured Aider command through `ShellAdapter`
- uses command arrays only
- captures a non-empty git diff
- writes `CandidatePatch`
- returns declared artifact names
- does not commit
- does not push

Current limitation:

- v1 supports `CandidatePatch` output only

## Aider PATCH Runtime Demo

The Aider PATCH demo wires `AiderCliWorkerAdapter` into the `PATCH` stage while all other stages use `DeterministicWorkerAdapter`.

The canonical `harnesses/crew.mvp.yaml` is not permanently changed. The demo creates a temporary harness variant where `PATCH.worker = "aider"`.

## Manual Aider Guard

The manual demo is guarded because it invokes real local Aider.

Without the opt-in environment variable, the demo refuses to run:

```text
Refusing to run real Aider. Set NLAH_RUN_REAL_AIDER=1 to run this demo.
```

Manual execution requires:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

Aider is not a package dependency. The demo config includes `--yes`, `--no-auto-commits`, `--no-gitignore`, `--map-tokens 0`, and `--no-restore-chat-history`. The demo Aider timeout is 120 seconds.

The current manual Aider command shape is:

```text
aider --yes --no-auto-commits --no-gitignore --map-tokens 0 --no-restore-chat-history --message-file <PATCH.md>
```

The Aider subprocess is run with:

```text
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
LC_ALL=en_US.UTF-8
LANG=en_US.UTF-8
```

A captured real run showed Aider entering normal model mode after reading `--message-file`:

```text
Using gpt-4o model with API key from environment.
Aider v0.86.2
Repo-map: using 4096 tokens, auto refresh
```

The runtime trace stopped at `stage_started PATCH`, with no `worker_completed`, because Aider did not exit. The demo passes `--yes` to force non-interactive confirmations.

A captured real-run Aider history showed:

```text
You can skip this check with --no-gitignore
```

The demo passes `--no-gitignore` because Aider may otherwise pause or block on a gitignore check in non-interactive use.

A later real run exposed a LiteLLM/OpenAI encoding failure:

```text
'ascii' codec can't encode character '\u201c'
```

The Aider prompt file now normalizes common Unicode punctuation to ASCII before writing the message file. This is Aider-specific prompt normalization and does not mutate `StageContext` or other runtime artifacts.

After that prompt normalization, `PATCH.md` was verified ASCII-only, but a real run still reported:

```text
OpenAIException - 'ascii' codec can't encode character '\u201c'
```

Aider v0.86.2 does not support `--no-map`, so the demo uses `--map-tokens 0` to disable repo map generation. The demo also disables chat history restoration to isolate Aider from non-prompt Unicode sources.

The demo passes UTF-8 Python and locale environment variables to the Aider subprocess only, after isolation still reproduced the same encoding failure.

The guarded real demo was retried after all local mitigations. It still ended with NLAH `empty git diff` because Aider/LiteLLM/OpenAI continued to report:

```text
OpenAIException - 'ascii' codec can't encode character '\u201c'
```

The latest captured history also shows `Repo-map: disabled`, so this is treated as a known external-tool issue rather than a crew runtime or adapter contract failure. The fake-shell tests remain the supported CI path for Aider integration.

## Fake-Shell Test Strategy

Automated tests do not invoke real Aider.

The Aider tests use fake shell implementations to verify:

- prompt file creation
- prompt contents
- Aider command construction
- model and extra argument handling
- diff command execution
- `CandidatePatch` creation from diff stdout
- empty diff failure
- failed Aider command failure
- failed diff command failure
- PATCH-stage runtime wiring through `WorkerRegistry`

## Required Verification

Run all required checks before cutting v0.1.1:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```

## Optional Real Aider Verification

This invokes real local Aider and is intentionally opt-in:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```
