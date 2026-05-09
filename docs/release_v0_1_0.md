# NLAH v0.1.0 — Crew Runtime Foundation

## Release Checklist

This release marks the v0.1.0 crew runtime foundation milestone.

## Completed Capabilities

- crew harness YAML
- schema validation
- compiler
- dataflow validation
- manifest command
- validate command
- runtime execution
- deterministic worker
- command worker
- script worker
- local CLI coding worker
- mock LLM worker
- Aider CLI worker adapter
- artifact contract enforcement
- trace ledger
- `summary.json`
- CLI JSON output
- run directory hygiene
- overwrite-run support

## Non-Goals

- no default external LLM calls
- no required Aider dependency
- no LangGraph
- no GitHub PR automation
- no cloud execution

## Required Verification

Run all required checks before cutting the release:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
pnpm tsx src/cli.ts validate --harness harnesses/crew.mvp.yaml
pnpm tsx src/cli.ts manifest --harness harnesses/crew.mvp.yaml
```

## Optional Manual Verification

This invokes real local Aider and is intentionally opt-in:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

## Release Readiness Criteria

- all required verification passes
- README current
- `docs/runtime.md` current
- `docs/aider_worker.md` current
- no generated runs committed
- `git status` clean
