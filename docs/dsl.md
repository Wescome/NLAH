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

Stage `inputs` declare the upstream artifact contents that workers receive in `StageContext.inputArtifacts`. The MVP crew harness treats these declarations as part of its dataflow contract. The compiler rejects a stage input unless an earlier stage in deterministic order has already produced that artifact.

The canonical MVP crew harness is:

```text
harnesses/crew.mvp.yaml
```

The legacy `harnesses/coding_swarm.mvp.yaml` path remains available for compatibility.
