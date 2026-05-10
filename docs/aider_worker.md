# Aider CLI Worker Design v1

## Purpose

`AiderCliWorkerAdapter` will be the first external coding-tool worker built on top of `LocalCliCodingWorkerAdapter` and `ShellAdapter`.

The adapter is intended to prove that NLAH can delegate a crew stage to an existing local coding tool while preserving the runtime contract: stages are still governed by declared artifacts, gates, state transitions, and trace records.

## Positioning

NLAH remains the crew runtime.

Aider is only a worker substrate. It must not own crew semantics, stage graph construction, artifact requirements, gate evaluation, state transitions, or trace persistence.

The boundary is:

```text
NLAH crew runtime
-> WorkerInput + StageContext
-> AiderCliWorkerAdapter
-> local aider command
-> declared artifacts
-> NLAH gates and trace
```

## Proposed Adapter

```ts
export class AiderCliWorkerAdapter implements WorkerAdapter {
  // implementation packet: feat: add aider cli worker adapter
}
```

The adapter should use `ShellAdapter` for process execution and command arrays only. It may share implementation patterns with `LocalCliCodingWorkerAdapter`, but it should keep Aider-specific prompt construction, diff capture, and artifact writing in its own module.

## Configuration

```ts
export type AiderCliWorkerConfig = {
  command?: string; // default "aider"
  model?: string;
  extraArgs?: string[];
  timeoutSeconds?: number;
};
```

`command` defaults to `aider`. `timeoutSeconds` should be required at runtime through an explicit default in the adapter, rather than allowing an unbounded process.

## Expected Behavior

For a stage executed by `AiderCliWorkerAdapter`:

1. Receive `WorkerInput`.
2. Write a stage prompt file under `runs/<runId>/worker_prompts/<stageName>.md`.
3. Invoke the configured Aider command with `cwd = input.state.repoPath`.
4. Allow Aider to edit repository files.
5. Capture `git diff` after the command completes.
6. Write `CandidatePatch` or other declared artifacts from the diff or stage outputs.
7. Return the declared artifact names in `WorkerOutput.createdArtifacts`.
8. Let NLAH gates verify patch application and release correctness.

The adapter must not treat successful natural-language output from Aider as proof that the stage is complete. Stage completion still depends on artifact contract validation and gates.

## MVP Stage Support

Start with `PATCH` only.

Other stages remain deterministic, script-backed, command-backed, or mock-backed until a later implementation packet expands support. The initial integration should bind only the `PATCH` stage to the Aider worker through `WorkerRegistry` while the rest of the crew remains unchanged.

## Safety

The adapter must enforce these constraints:

- no `shell=true`
- command array only
- `cwd = repoPath`
- timeout required
- no auto commit
- no push
- no destructive git operations
- generated prompt stored as an artifact or run file

The adapter must not run `git reset`, `git checkout`, forced clean operations, commits, or pushes. If cleanup is needed, it belongs outside the adapter and must be explicit.

## Manual Demo Guard

The runtime demo script is optional because it invokes real local Aider. Aider is not installed by this repo, is not a package dependency, and automated tests use a fake shell instead of invoking it.

Install Aider manually before running the real demo:

```bash
python -m pip install aider-chat
aider --version
```

Manual runs must opt in explicitly:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

Without `NLAH_RUN_REAL_AIDER=1`, the script prints:

```text
Refusing to run real Aider. Set NLAH_RUN_REAL_AIDER=1 to run this demo.
```

The demo config includes `--yes`, `--no-auto-commits`, `--no-gitignore`, `--map-tokens 0`, and `--no-restore-chat-history`. The adapter does not commit or push. The demo timeout is 120 seconds.

The current manual Aider command shape is:

```text
aider --yes --no-auto-commits --no-gitignore --map-tokens 0 --no-restore-chat-history --message-file <PATCH.md>
```

The demo also runs the Aider subprocess with UTF-8 Python and locale environment variables:

```text
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
LC_ALL=en_US.UTF-8
LANG=en_US.UTF-8
```

The `--yes` flag is demo-specific. A captured real run showed Aider entering normal model mode after reading `--message-file`:

```text
Using gpt-4o model with API key from environment.
Aider v0.86.2
Repo-map: using 4096 tokens, auto refresh
```

The runtime trace stopped at `stage_started PATCH`, with no `worker_completed`, because Aider did not exit. The demo now passes `--yes` to force non-interactive confirmations.

The `--no-gitignore` flag is demo-specific. A captured real-run Aider history showed:

```text
You can skip this check with --no-gitignore
```

Without that flag, Aider may pause or block on a gitignore check in non-interactive manual runs.

The repo-map isolation flag is demo-specific. Aider v0.86.2 does not support `--no-map`; the supported command shape is `--map-tokens 0`.

`--map-tokens 0` and `--no-restore-chat-history` are also demo-specific. After prompt normalization, `PATCH.md` was verified ASCII-only, but a real run still hit:

```text
OpenAIException - 'ascii' codec can't encode character '\u201c'
```

The demo disables repo map generation and chat history restoration to isolate Aider from non-prompt Unicode sources while preserving the NLAH runtime behavior.

The same error persisted after isolation and after passing the UTF-8 subprocess environment. The captured Aider history shows:

```text
Repo-map: disabled
OpenAIException - 'ascii' codec can't encode character '\u201c'
```

This is recorded as a known external-tool issue in the local Aider/LiteLLM/OpenAI path. The NLAH adapter path remains covered by fake-shell tests, which are the supported CI verification path for this external-tool integration until the upstream/runtime encoding issue is resolved.

After `NLAH_RUN_REAL_AIDER=1` is set, the demo runs a preflight check with `aider --version`. If Aider is unavailable, it prints install guidance and exits before `runHarness` starts.

## Prompt File

The Aider message file normalizes common Unicode punctuation to ASCII before writing the prompt. This is local to `AiderCliWorkerAdapter` prompt generation and does not mutate `StageContext` or runtime artifacts.

A real run exposed a LiteLLM/OpenAI encoding failure:

```text
'ascii' codec can't encode character '\u201c'
```

The adapter normalizes curly quotes, en dashes, em dashes, ellipses, and non-breaking spaces in the Aider prompt file only.

The generated prompt path is:

```text
runs/<runId>/worker_prompts/<stageName>.md
```

The prompt must include:

- task text
- role text
- input artifacts
- declared outputs
- instruction to produce a minimal patch
- instruction not to commit

Prompt outline:

```md
# NLAH Stage Prompt

## Stage

PATCH

## Task

...

## Role Policy

...

## Input Artifacts

### IssueContract

...

### RepoMap

...

## Declared Outputs

- CandidatePatch

## Instructions

Produce the smallest correct repository change for this stage.
Do not commit.
Do not push.
Do not perform destructive git operations.
```

## Patch Capture

After Aider exits successfully, the adapter should run:

```text
git diff -- src
```

or a configured non-destructive diff command. For the initial MVP, writing `CandidatePatch` from `git diff` is sufficient.

If the diff is empty, the adapter must fail with a `RuntimeError` instead of writing an empty `CandidatePatch`.

The runtime will still enforce:

- `createdArtifacts` exactly match declared outputs
- declared artifact files exist
- declared artifact files are non-empty
- gates pass

## Test Plan

Tests should avoid invoking real Aider.

Required tests:

- unit test command construction without running Aider
- fake shell test simulates Aider output
- generated prompt contains `taskText`
- generated prompt contains input artifacts
- `CandidatePatch` is written from `git diff`
- missing diff fails
- adapter returns declared artifact names
- adapter does not auto commit or push

The fake shell should capture command arrays and return controlled stdout, stderr, return code, and diff content without spawning external tooling.

## Implementation Packet

Next implementation packet:

```text
feat: add aider cli worker adapter
```

## Verification

The adapter implementation must preserve:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```
