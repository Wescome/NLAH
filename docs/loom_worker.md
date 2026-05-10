# Loom CLI Worker

## Purpose

`LoomCliWorkerAdapter` is the preferred NLAH name for a domain-aware CLI coding worker that uses the Pi terminal harness as its first command substrate.

NLAH remains the crew runtime. Loom is only a worker layer behind `WorkerInput`, `StageContext`, artifact contracts, gates, trace, and summaries.

## Positioning

The boundary is:

```text
NLAH Crew Runtime
-> WorkerInput + StageContext
-> LoomCliWorkerAdapter
-> local Pi command
-> repo changes / command output
-> CandidatePatch artifact
-> NLAH gates and trace
```

Loom does not own crew semantics, stage ordering, artifact contracts, gate evaluation, trace events, or run summaries.

## v1 Scope

- CLI only
- Pi command substrate
- text/json print mode only
- one output artifact per stage
- PATCH-stage runtime demo
- fake-shell tests
- no real Pi invocation in CI

## Domain Config

`LoomDomainConfig` lets callers add domain-specific context to the generated prompt:

```ts
type LoomDomainConfig = {
  domain: string;
  promptTemplate?: string;
  contextGlobs?: string[];
  outputArtifactType?: string;
  diffStrategy?: "git" | "document" | "structured";
  constraints?: string[];
};
```

The current implementation captures `git diff` and writes it to the configured single output artifact. In practice, v1 is intended for patch-like outputs such as `CandidatePatch`.

## Command Shape

Pi argument semantics:

- `-p` / `--print` is a boolean flag.
- `@file` passes file contents as a file argument.
- `--mode json` selects JSON output mode.

Text mode:

```text
pi -p @<promptPath>
```

JSON mode:

```text
pi -p --mode json @<promptPath>
```

The Loom PATCH demo uses JSON mode so real manual runs can persist event-oriented stdout for debugging.

## Runtime Demo

The optional runtime demo wires `LoomCliWorkerAdapter` into the PATCH stage while all other stages use `DeterministicWorkerAdapter`:

```bash
NLAH_RUN_REAL_LOOM=1 pnpm run:loom-patch-demo
```

The demo creates a temporary harness variant from `harnesses/crew.mvp.yaml` where `PATCH.worker = "loom"`. It does not permanently change the canonical crew harness.

Automated tests use a fake shell and do not invoke real Pi. Manual use currently requires Pi to be installed separately and verified with `pi --version`.

Without `NLAH_RUN_REAL_LOOM=1`, the script refuses to run:

```text
Refusing to run real Loom. Set NLAH_RUN_REAL_LOOM=1 to run this demo.
```

## Debug Artifacts

If the Loom command fails, times out, or exits without a captured diff, the adapter writes debug artifacts under:

```text
runs/<runId>/debug/
- loom.command.json
- loom.stdout
- loom.stderr
- loom.result.json
- loom.diff_command.json
- loom.diff_stdout
- loom.diff_stderr
- loom.diff_result.json
```

The `loom.diff_*` files are written only after the Loom command exits and NLAH attempts to capture `git diff`.

## Safety

- no `shell=true`
- command arrays only
- no commit/push
- no destructive git operations
- timeout required
- optional env support
- NLAH remains responsible for artifact gates and trace

## Verification

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```
