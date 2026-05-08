# NLAH

Natural-Language Agent Harness runtime for artifact-gated coding swarms.

## What this is

NLAH is a TypeScript-first runtime for executing structured natural-language harnesses.

A harness defines:

- roles
- stages
- artifacts
- gates
- failure modes
- runtime state

The runtime executes the harness as a typed artifact-gated WorkGraph.

## MVP

The MVP runs a deterministic coding-swarm harness:

```bash
pnpm install
pnpm run:mvp
```

Expected output:

```text
Status: PASS
State: PullRequestReady
```

## Architecture

```text
YAML Harness
-> Zod Schema
-> Compiler
-> Stage Graph
-> Runtime
-> Artifacts
-> Gates
-> Trace Ledger
```

## v0 Scope

Included:

- YAML harness loading
- Zod validation
- graph compilation
- deterministic stage execution
- artifact manager
- gate evaluator
- JSONL trace ledger
- CLI

Not included yet:

- LLM calls
- LangGraph
- GitHub PR creation
- real multi-agent execution
