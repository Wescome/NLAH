# Architecture

NLAH externalizes crew orchestration into harness artifacts. The runtime parses a YAML DSL into a typed semantic model, compiles stages into a WorkGraph, executes declared role policies through workers, enforces artifacts, evaluates gates, and records a trace ledger.

A crew is a role-based execution unit made of stages, roles, artifacts, workers, gates, and traces. Coding is currently the first crew specialization, but the runtime is designed around the crew abstraction rather than coding-only controller logic.

The architectural mapping is:

- Strategy: harness objective
- Structure: roles
- Processes: stages
- Rewards: gates and verdicts
- People: role and worker capabilities
