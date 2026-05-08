# DSL

The MVP crew DSL is a YAML document with:

- `nlahspec`
- `harness`
- `runtime`
- `roles`
- `artifacts`
- `stages`
- `failure_taxonomy`

Stages define transitions from one runtime state to another. Artifacts and gates define the executable contract for completing each transition.

The canonical MVP crew harness is:

```text
harnesses/crew.mvp.yaml
```

The legacy `harnesses/coding_swarm.mvp.yaml` path remains available for compatibility.
