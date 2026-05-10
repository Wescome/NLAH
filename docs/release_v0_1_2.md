# NLAH v0.1.2 — Pi CLI Worker Path

## Release Notes

This release documents the Pi CLI worker path after the fake-shell runtime demo was implemented.

## Included Capabilities

- `PiCliWorkerAdapter`
- Pi PATCH runtime demo
- fake-shell test strategy
- no real Pi dependency
- no real Pi invocation in CI
- `CandidatePatch`-only v1 limitation
- future `PiRpcWorkerAdapter` and `PiSdkWorkerAdapter` path

## PiCliWorkerAdapter

`PiCliWorkerAdapter` treats Pi as a terminal coding harness worker substrate. NLAH remains responsible for crew semantics, stage graph execution, artifact contracts, gates, traces, and summaries.

Current behavior:

- writes a stage prompt under `runs/<runId>/worker_prompts/<stageName>.pi.md`
- invokes a configured Pi command through `ShellAdapter`
- supports print and JSON command modes
- captures a non-empty git diff
- writes `CandidatePatch`
- returns declared artifact names
- does not commit
- does not push

Current limitation:

- v1 supports `CandidatePatch` output only

## Pi PATCH Runtime Demo

The Pi PATCH demo wires `PiCliWorkerAdapter` into the `PATCH` stage while all other stages use `DeterministicWorkerAdapter`.

The canonical `harnesses/crew.mvp.yaml` is not permanently changed. The demo creates a temporary harness variant where `PATCH.worker = "pi"`.

Package script:

```bash
NLAH_RUN_REAL_PI=1 pnpm run:pi-patch-demo
```

This script is optional. It may require real Pi if run manually, but automated verification does not require real Pi.

Without `NLAH_RUN_REAL_PI=1`, the script refuses to run. When the guard is set, the script checks `pi --version` before starting the runtime.

## Fake-Shell Test Strategy

Automated tests do not invoke real Pi.

The Pi tests use fake shell implementations to verify:

- prompt file creation
- prompt contents
- Pi command construction
- print/json mode behavior
- extra argument handling
- optional environment handling
- diff command execution
- `CandidatePatch` creation from diff stdout
- empty diff failure
- failed Pi command failure
- failed diff command failure
- PATCH-stage runtime wiring through `WorkerRegistry`

## Required Verification

Run all required checks before cutting v0.1.2:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```

## Optional Manual Verification

No real Pi command is required for this release.

Only add real Pi manual verification after a guarded real Pi demo exists.

## Future

Future Pi integration paths:

- `PiRpcWorkerAdapter`
- `PiSdkWorkerAdapter`
- NLAH-specific Pi extension package
- Pi package containing NLAH skills and prompts
