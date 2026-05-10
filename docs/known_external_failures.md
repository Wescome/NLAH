# Known External Failures

This file tracks failures observed in external tools that sit outside the NLAH runtime contract.

NLAH-owned behavior remains verified through deterministic workers, fake providers, fake shells, artifact contracts, gates, traces, and summaries. External-tool failures should not be treated as crew runtime regressions unless they violate a runtime-owned contract.

## Aider/LiteLLM/OpenAI ASCII Encoding Failure

Status: open external-tool issue

Affected path:

```text
AiderCliWorkerAdapter
-> local aider command
-> LiteLLM/OpenAI request path
```

Observed command shape:

```text
aider --yes --no-auto-commits --no-gitignore --map-tokens 0 --no-restore-chat-history --message-file <PATCH.md>
```

The Aider subprocess is also run with:

```text
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
LC_ALL=en_US.UTF-8
LANG=en_US.UTF-8
```

Observed result:

```text
NLAH status: FAIL
NLAH message: empty git diff
```

Captured Aider history repeatedly reports:

```text
Repo-map: disabled
OpenAIException - 'ascii' codec can't encode character '\u201c'
```

Evidence already ruled out:

- NLAH prompt file Unicode punctuation: the Aider message file normalizes common Unicode punctuation to ASCII before execution.
- Repo-map context: the manual demo uses `--map-tokens 0`, and Aider history reports `Repo-map: disabled`.
- Restored chat history: the manual demo uses `--no-restore-chat-history`.
- Python process defaults: the demo passes UTF-8 Python and locale environment variables to the Aider subprocess.

Current conclusion:

The local Aider/LiteLLM/OpenAI path fails before producing repository edits. The NLAH runtime correctly fails because `git diff` is empty and no `CandidatePatch` artifact can be produced.

Supported verification path:

```bash
pnpm typecheck
pnpm test
pnpm run:mvp
pnpm run:script-demo
pnpm run:mock-llm-demo
pnpm run:local-cli-demo
```

The Aider integration remains CI-verified through fake-shell tests. Real Aider execution is optional and guarded:

```bash
NLAH_RUN_REAL_AIDER=1 pnpm run:aider-patch-demo
```

Next action:

Do not add more demo flags without new evidence from Aider, LiteLLM, OpenAI client behavior, or the local Python runtime. Continue NLAH-owned work around deterministic worker contracts, artifact semantics, and verifiable tool boundaries.
