# Architecture

NLAH externalizes coding-swarm orchestration into harness artifacts. The
runtime parses a YAML DSL into a typed semantic model, compiles stages into a
WorkGraph, executes declared role policies, enforces artifacts, evaluates
gates, and records a trace ledger.

The architectural mapping is:

- Strategy: harness objective
- Structure: roles
- Processes: stages
- Rewards: gates and verdicts
- People: role capabilities
