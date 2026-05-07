# NLAH

NLAH is a TypeScript-first Natural-Language Agent Harness runtime for
artifact-gated multi-agent coding swarms.

The MVP makes harness control explicit:

```text
NLAH DSL -> typed semantic model -> harness compiler -> executable WorkGraph
-> artifact-gated runtime -> trace ledger
```

Run the MVP harness:

```bash
pnpm install
pnpm tsx src/cli.ts run \
  --harness harnesses/coding_swarm.mvp.yaml \
  --repo ./examples/target_repo_stub \
  --task ./examples/TASK.md
```

Verify the implementation:

```bash
pnpm run verify
```
