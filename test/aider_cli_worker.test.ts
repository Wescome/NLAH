import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEnv, AdapterResult } from "../src/adapters.js";
import { FsArtifactManager, type ArtifactManager } from "../src/artifacts.js";
import { AiderCliWorkerAdapter } from "../src/aider_cli_worker.js";
import { RuntimeError } from "../src/errors.js";
import type { RuntimeState } from "../src/state.js";
import type { WorkerInput } from "../src/workers.js";
import { tempDir, validSpec } from "./helpers.js";

const patch = [
  "diff --git a/src/math.ts b/src/math.ts",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -1,3 +1,3 @@",
  " export function add(a: number, b: number): number {",
  "-  return a - b;",
  "+  return a + b;",
  " }",
  ""
].join("\n");

type ShellCall = {
  command: string[];
  cwd: string;
  timeoutSeconds?: number;
  env?: AdapterEnv;
};

class FakeShell {
  readonly calls: ShellCall[] = [];

  constructor(private readonly responses: AdapterResult[]) {}

  async run(command: string[], cwd: string, timeoutSeconds?: number, env?: AdapterEnv): Promise<AdapterResult> {
    this.calls.push({
      command,
      cwd,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      ...(env === undefined ? {} : { env })
    });
    return (
      this.responses.shift() ?? {
        ok: true,
        returncode: 0,
        stdout: "",
        stderr: ""
      }
    );
  }
}

async function fixture(overrides: Partial<WorkerInput> = {}): Promise<{
  artifacts: ArtifactManager;
  input: WorkerInput;
  root: string;
}> {
  const root = await tempDir("nlah-aider-cli-worker-");
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  const artifacts = new FsArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "aider-cli-worker-test",
    currentState: "RepoMapped",
    taskPath: path.join(root, "TASK.md"),
    repoPath: repo,
    harnessPath: path.resolve("harnesses/crew.mvp.yaml"),
    runRoot: root,
    stateRoot: path.join(root, "state"),
    artifactRoot: path.join(root, "artifacts"),
    stageHistory: [],
    artifacts: {}
  };

  const input: WorkerInput = {
    stageName: "PATCH",
    roleName: "PatchWorker",
    context: {
      taskText: "Fix add() so it returns a + b.",
      roleText: "Patch only the minimal code path.",
      inputArtifacts: {
        IssueContract: "Issue contract text",
        RepoMap: "Repo map text"
      },
      outputArtifactPaths: {
        CandidatePatch: artifacts.resolve("CandidatePatch")
      }
    },
    state,
    declaredInputs: ["IssueContract", "RepoMap"],
    declaredOutputs: ["CandidatePatch"],
    ...overrides
  };

  return { artifacts, input, root };
}

function ok(stdout = ""): AdapterResult {
  return {
    ok: true,
    returncode: 0,
    stdout,
    stderr: ""
  };
}

function fail(stderr = "failed", returncode = 1): AdapterResult {
  return {
    ok: false,
    returncode,
    stdout: "",
    stderr
  };
}

describe("AiderCliWorkerAdapter", () => {
  it("writes the prompt file with task text, role text, and input artifacts", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await worker.execute(input, artifacts);

    const promptPath = path.join(root, "worker_prompts", "PATCH.md");
    await expect(stat(promptPath)).resolves.toBeTruthy();
    const prompt = await readFile(promptPath, "utf8");
    expect(prompt).toContain("# NLAH Stage Prompt");
    expect(prompt).toContain("PATCH");
    expect(prompt).toContain("Fix add() so it returns a + b.");
    expect(prompt).toContain("Patch only the minimal code path.");
    expect(prompt).toContain("### IssueContract");
    expect(prompt).toContain("Issue contract text");
    expect(prompt).toContain("### RepoMap");
    expect(prompt).toContain("Repo map text");
    expect(prompt).toContain("- CandidatePatch");
    expect(prompt).toContain("Produce the smallest correct repository change");
    expect(prompt).toContain("Do not commit.");
    expect(prompt).toContain("Do not push.");
    expect(prompt).toContain("Do not perform destructive git operations.");
  });

  it("builds the aider command with message file, model, and extra args", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter(
      {
        command: "aider",
        model: "test-model",
        extraArgs: ["--yes", "--no-auto-commits"],
        timeoutSeconds: 42
      },
      shell
    );

    await worker.execute(input, artifacts);

    expect(shell.calls[0]).toEqual({
      command: [
        "aider",
        "--model",
        "test-model",
        "--yes",
        "--no-auto-commits",
        "--message-file",
        path.join(root, "worker_prompts", "PATCH.md")
      ],
      cwd: input.state.repoPath,
      timeoutSeconds: 42
    });
  });

  it("normalizes common Unicode punctuation in the prompt file", async () => {
    const { artifacts, input, root } = await fixture();
    input.context = {
      taskText: "Fix add() so it returns \u201Csum\u201D \u2014 not subtraction\u2026",
      roleText: "Use the repo\u2019s style \u2013 keep it minimal.",
      inputArtifacts: {
        IssueContract: "Don\u2018t change unrelated files\u00A0or tests.",
        RepoMap: "Relevant file: src/math.ts"
      },
      outputArtifactPaths: {
        CandidatePatch: artifacts.resolve("CandidatePatch")
      }
    };
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await worker.execute(input, artifacts);

    const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.md"), "utf8");
    expect(prompt).toContain('Fix add() so it returns "sum" - not subtraction...');
    expect(prompt).toContain("Use the repo's style - keep it minimal.");
    expect(prompt).toContain("Don't change unrelated files or tests.");
    expect(prompt).toContain("Relevant file: src/math.ts");
    expect(prompt).not.toContain("\u201C");
    expect(prompt).not.toContain("\u201D");
    expect(prompt).not.toContain("\u2014");
    expect(prompt).not.toContain("\u2013");
    expect(prompt).not.toContain("\u2026");
    expect(prompt).not.toContain("\u00A0");
  });

  it("runs the diff command after the aider command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter({ diffCommand: ["git", "diff", "--", "src/math.ts"] }, shell);

    await worker.execute(input, artifacts);

    expect(shell.calls).toHaveLength(2);
    expect(shell.calls[1]).toEqual({
      command: ["git", "diff", "--", "src/math.ts"],
      cwd: input.state.repoPath,
      timeoutSeconds: 300
    });
  });

  it("passes configured environment to the aider command only", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const env = {
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
    };
    const worker = new AiderCliWorkerAdapter({ env }, shell);

    await worker.execute(input, artifacts);

    expect(shell.calls[0]?.env).toEqual(env);
    expect(shell.calls[1]?.env).toBeUndefined();
  });

  it("writes CandidatePatch from diff stdout and returns created artifacts", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    const result = await worker.execute(input, artifacts);

    expect(result).toEqual({
      createdArtifacts: ["CandidatePatch"],
      message: "aider done"
    });
    await expect(readFile(artifacts.resolve("CandidatePatch"), "utf8")).resolves.toBe(patch);
  });

  it("throws RuntimeError for an empty git diff", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("aider done"), ok("   \n")]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("empty git diff");
  });

  it("throws RuntimeError for a failed aider command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([fail("aider failed", 2)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow(RuntimeError);
    expect(shell.calls).toHaveLength(1);
  });

  it("includes failed metadata in failed aider command errors", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([
      {
        ok: false,
        returncode: 1,
        stdout: "",
        stderr: "aider failed",
        failed: true
      }
    ]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("failed: true");
  });

  it("throws RuntimeError for a failed diff command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("aider done"), fail("diff failed", 3)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow(RuntimeError);
    expect(shell.calls).toHaveLength(2);
  });

  it("throws RuntimeError for unsupported declared outputs", async () => {
    const { artifacts, input } = await fixture();
    input.declaredOutputs = ["RepoMap"];
    input.context = {
      taskText: "Fix add()",
      inputArtifacts: {},
      outputArtifactPaths: {
        RepoMap: artifacts.resolve("RepoMap")
      }
    };
    const shell = new FakeShell([ok("aider done"), ok(patch)]);
    const worker = new AiderCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow(
      "AiderCliWorkerAdapter v1 only supports CandidatePatch output"
    );
    expect(shell.calls).toHaveLength(0);
  });
});
