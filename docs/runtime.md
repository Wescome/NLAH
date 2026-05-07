# Runtime

The runtime creates `runs/<run_id>/`, copies the task file, writes artifacts
under `artifacts/`, and appends provenance events to
`state/task_history.jsonl`.

Stages complete only when declared outputs exist and declared gates pass.
The MVP role execution is deterministic and does not call LLMs.
