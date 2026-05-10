# Worker Adapter Matrix

NLAH workers are execution substrates behind the crew runtime. They receive `WorkerInput`, including `StageContext`, and must produce declared artifacts that the runtime can validate with gates, trace events, and summaries.

## Adapter Matrix

| Adapter | Purpose | External Dependency Required? | Uses StageContext? | Writes Artifacts? | Best Use Case | Current Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| `DeterministicWorkerAdapter` | Writes known MVP artifacts without external tools. | No | Receives it, but mostly ignores it. | Yes | Baseline runtime execution, tests, deterministic demos. | Fixed MVP fixture behavior; not a real coding worker. |
| `CommandWorkerAdapter` | Dispatches stage execution to registered TypeScript handler functions. | No | Yes | Handler decides, usually through `ArtifactManager`. | Controlled in-process integrations and tests. | Handlers are supplied programmatically; no CLI or model boundary. |
| `ScriptWorkerAdapter` | Runs registered local `string[]` commands through `ShellAdapter`. | Only the configured local command. | Yes | Command writes outputs, usually through `outputArtifactPaths`. | Small local automation demos and controlled script execution. | Stage commands must be preconfigured; no coding-tool-specific behavior. |
| `LocalCliCodingWorkerAdapter` | Generic seam for local coding CLI tools. | Only the configured local command. | Yes | Command writes outputs, usually through `outputArtifactPaths`. | Future Aider, Codex CLI, Claude Code, OpenHands, or custom local tool wiring. | Generic command wrapper; does not build prompts or capture diffs by itself. |
| `LlmWorkerAdapter` | Provider-neutral model boundary with an injected provider. | No default dependency; provider is injected. | Yes | Yes, writes returned artifact content through `ArtifactManager`. | Mock LLM tests and future model-provider adapters. | No provider SDKs included; no external calls by default. |
| `AiderCliWorkerAdapter` | Aider-specific PATCH-stage adapter that writes a prompt, invokes Aider, captures git diff, and writes `CandidatePatch`. | Yes for manual use: local Aider binary. No for tests. | Yes | Yes, writes `CandidatePatch`. | First external coding-tool path for PATCH-stage experiments. | v1 supports only `CandidatePatch`; tests use fake shell; manual demo is guarded. |
| `LoomCliWorkerAdapter` | Domain-aware CLI worker that uses Pi as the current command substrate and writes Loom-named prompts/debug artifacts. | Yes for manual use: local Pi binary. No for tests. | Yes | Yes, writes the configured single artifact from captured diff. | Preferred NLAH name for domain-specific PATCH-stage CLI experiments. | v1 is intended for patch-like outputs; tests use fake shell; manual demo is guarded. |

## Worker Hierarchy

`DeterministicWorkerAdapter` is the baseline for runtime correctness and repeatable tests.

`CommandWorkerAdapter` and `ScriptWorkerAdapter` cover local controlled execution. Command workers stay in-process; script workers cross a process boundary through `ShellAdapter`.

`LocalCliCodingWorkerAdapter` is the generic coding CLI seam. It gives local tools a `StageContext` packet and a controlled command execution path without hardcoding a specific tool.

`LlmWorkerAdapter` is the provider-neutral model boundary. It defines the request and response shape for future model-backed workers while keeping provider SDKs outside the runtime.

`AiderCliWorkerAdapter` is the first external coding-tool specialization. It builds on the same worker contract but adds Aider-specific prompt generation and diff capture for the `PATCH` stage.

`LoomCliWorkerAdapter` is the preferred NLAH-facing name for the Pi-backed domain worker path. It adds domain prompt sections and Loom-named debug artifacts while keeping Pi as an interchangeable CLI substrate.

## Recommended Path

Use the deterministic worker for the default MVP:

```bash
pnpm run:mvp
```

Use local demos to exercise alternate worker boundaries without external services:

```bash
pnpm run:script-demo
pnpm run:local-cli-demo
pnpm run:mock-llm-demo
```

Use the Aider PATCH demo as the first external-tool path. Automated tests use a fake shell. Manual runs require local Aider and explicit opt-in:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

Use the Loom PATCH demo as the preferred Pi-backed domain-worker path. Automated tests use a fake shell. Manual runs require local Pi and explicit opt-in:

```bash
NLAH_RUN_REAL_LOOM=1 pnpm run:loom-patch-demo
```

Future worker work should either expand Aider beyond `PATCH` or add specialized adapters for Codex CLI, Claude Code, OpenHands, or other local coding tools.

## Verification

Run the standard verification set after worker adapter changes:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```
