# DSL

The MVP DSL is a YAML document with:

- `nlahspec`
- `harness`
- `runtime`
- `roles`
- `artifacts`
- `stages`
- `failure_taxonomy`

Stages define transitions from one runtime state to another. Artifacts and
gates define the executable contract for completing each transition.
