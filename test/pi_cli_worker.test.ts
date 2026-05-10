import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEnv, AdapterResult } from "../src/adapters.js";
import { ArtifactManager } from "../src/artifacts.js";
import { RuntimeError } from "../src/errors.js";
import { PiCliWorkerAdapter } from "../src/pi_cli_worker.js";
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
  const root = await tempDir("nlah-pi-cli-worker-");
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "pi-cli-worker-test",
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

function fail(stderr = "failed", returncode = 1, stdout = ""): AdapterResult {
  return {
    ok: false,
    returncode,
    stdout,
    stderr
  };
}

describe("PiCliWorkerAdapter", () => {
  it("writes the prompt file with task text, role text, input artifacts, outputs, and instructions", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await worker.execute(input, artifacts);

    const promptPath = path.join(root, "worker_prompts", "PATCH.pi.md");
    await expect(stat(promptPath)).resolves.toBeTruthy();
    const prompt = await readFile(promptPath, "utf8");
    expect(prompt).toContain("# NLAH Pi Stage Prompt");
    expect(prompt).toContain("## Stage\nPATCH");
    expect(prompt).toContain("## Role\nPatchWorker");
    expect(prompt).toContain("Fix add() so it returns a + b.");
    expect(prompt).toContain("Patch only the minimal code path.");
    expect(prompt).toContain("### IssueContract");
    expect(prompt).toContain("Issue contract text");
    expect(prompt).toContain("### RepoMap");
    expect(prompt).toContain("Repo map text");
    expect(prompt).toContain("- CandidatePatch");
    expect(prompt).toContain("Do not commit.");
    expect(prompt).toContain("leave repository changes unstaged");
  });

  it("normalizes common Unicode punctuation in the prompt file", async () => {
    const { artifacts, input, root } = await fixture();
    input.context = {
      taskText: "Fix add() so it returns \u201Csum\u201D.",
      roleText: "Use the repo style \u2014 keep it minimal.",
      inputArtifacts: {
        IssueContract: "Patch only this behavior\u2026",
        RepoMap: "Relevant file: src/math.ts\u00A0only"
      },
      outputArtifactPaths: {
        CandidatePatch: artifacts.resolve("CandidatePatch")
      }
    };
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await worker.execute(input, artifacts);

    const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.pi.md"), "utf8");
    expect(prompt).toContain('Fix add() so it returns "sum".');
    expect(prompt).toContain("Use the repo style - keep it minimal.");
    expect(prompt).toContain("Patch only this behavior...");
    expect(prompt).toContain("Relevant file: src/math.ts only");
    expect(prompt).not.toContain("\u201C");
    expect(prompt).not.toContain("\u201D");
    expect(prompt).not.toContain("\u2014");
    expect(prompt).not.toContain("\u2026");
  });

  it("builds the default text-mode command", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({}, shell);
    const promptPath = path.join(root, "worker_prompts", "PATCH.pi.md");

    await worker.execute(input, artifacts);

    expect(shell.calls[0]).toEqual({
      command: ["pi", "-p", `@${promptPath}`],
      cwd: input.state.repoPath,
      timeoutSeconds: 300
    });
    expect(shell.calls[0]?.command).not.toContain(promptPath);
    expect(shell.calls[0]?.command).toContain(`@${promptPath}`);
    expect(shell.calls[0]?.command).not.toContain("--mode");
    expect(shell.calls[0]?.command).not.toContain("json");
  });

  it("builds the json-mode command", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({ mode: "json" }, shell);

    await worker.execute(input, artifacts);

    expect(shell.calls[0]?.command).toEqual([
      "pi",
      "-p",
      "--mode",
      "json",
      `@${path.join(root, "worker_prompts", "PATCH.pi.md")}`
    ]);
  });

  it("appends extra args", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({ extraArgs: ["--some-flag"] }, shell);

    await worker.execute(input, artifacts);

    expect(shell.calls[0]?.command).toEqual([
      "pi",
      "-p",
      `@${path.join(root, "worker_prompts", "PATCH.pi.md")}`,
      "--some-flag"
    ]);
  });

  it("passes configured environment to Pi command only", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const env = {
      PI_TEST_ENV: "1"
    };
    const worker = new PiCliWorkerAdapter({ env }, shell);

    await worker.execute(input, artifacts);

    expect(shell.calls[0]?.env).toEqual(env);
    expect(shell.calls[1]?.env).toBeUndefined();
  });

  it("runs diff after Pi, writes CandidatePatch, and returns created artifact plus message", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({ diffCommand: ["git", "diff", "--", "src/math.ts"] }, shell);

    const result = await worker.execute(input, artifacts);

    expect(shell.calls).toHaveLength(2);
    expect(shell.calls[1]).toEqual({
      command: ["git", "diff", "--", "src/math.ts"],
      cwd: input.state.repoPath,
      timeoutSeconds: 300
    });
    await expect(readFile(artifacts.resolve("CandidatePatch"), "utf8")).resolves.toBe(patch);
    expect(result).toEqual({
      createdArtifacts: ["CandidatePatch"],
      message: "pi done"
    });
  });

  it("throws RuntimeError for a failed Pi command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([fail("pi failed", 2, "pi stdout")]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("pi command failed");
    expect(shell.calls[0]?.command[0]).toBe("pi");
  });

  it("includes timeout metadata in failed Pi command errors", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([
      {
        ok: false,
        returncode: 1,
        stdout: "",
        stderr: "timed out",
        timedOut: true
      }
    ]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("timed out: true");
  });

  it("writes Pi debug artifacts when the Pi command fails", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([
      {
        ok: false,
        returncode: 1,
        stdout: '{"type":"session_start"}\n',
        stderr: "timed out",
        timedOut: true,
        signal: "SIGTERM",
        failed: true
      }
    ]);
    const worker = new PiCliWorkerAdapter({ mode: "json" }, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow(`debug: ${path.join(root, "debug")}`);

    const command = JSON.parse(await readFile(path.join(root, "debug", "pi.command.json"), "utf8")) as {
      command: string[];
    };
    const result = JSON.parse(await readFile(path.join(root, "debug", "pi.result.json"), "utf8")) as AdapterResult;

    expect(command.command).toEqual([
      "pi",
      "-p",
      "--mode",
      "json",
      `@${path.join(root, "worker_prompts", "PATCH.pi.md")}`
    ]);
    await expect(readFile(path.join(root, "debug", "pi.stdout"), "utf8")).resolves.toBe(
      '{"type":"session_start"}\n'
    );
    await expect(readFile(path.join(root, "debug", "pi.stderr"), "utf8")).resolves.toBe("timed out");
    expect(result).toEqual({
      ok: false,
      returncode: 1,
      stdout: '{"type":"session_start"}\n',
      stderr: "timed out",
      timedOut: true,
      signal: "SIGTERM",
      failed: true
    });
  });

  it("redacts api keys in Pi failure diagnostics", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([
      {
        ok: false,
        returncode: 1,
        stdout: "",
        stderr: "provider failed"
      }
    ]);
    const worker = new PiCliWorkerAdapter({ extraArgs: ["--api-key", "secret-pi-key"] }, shell);

    let message = "";
    try {
      await worker.execute(input, artifacts);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("command: pi -p");
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("secret-pi-key");

    const command = JSON.parse(await readFile(path.join(root, "debug", "pi.command.json"), "utf8")) as {
      command: string[];
    };
    expect(command.command).toContain("[redacted]");
    expect(command.command).not.toContain("secret-pi-key");
  });

  it("writes diff debug artifacts when Pi exits without a diff", async () => {
    const { artifacts, input, root } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok("   \n")]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("empty git diff");

    await expect(readFile(path.join(root, "debug", "pi.stdout"), "utf8")).resolves.toBe("pi done");
    await expect(readFile(path.join(root, "debug", "pi.diff_stdout"), "utf8")).resolves.toBe("   \n");
    const diffCommand = JSON.parse(await readFile(path.join(root, "debug", "pi.diff_command.json"), "utf8")) as {
      command: string[];
    };
    expect(diffCommand.command).toEqual(["git", "diff", "--", "src"]);
  });

  it("includes signal metadata in failed Pi command errors", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([
      {
        ok: false,
        returncode: 1,
        stdout: "",
        stderr: "terminated",
        signal: "SIGTERM"
      }
    ]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("signal: SIGTERM");
  });

  it("throws RuntimeError for a failed diff command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("pi done"), fail("diff failed", 3, "diff stdout")]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("pi diff command failed");
    expect(shell.calls).toHaveLength(2);
  });

  it("throws RuntimeError for an empty git diff", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok("   \n")]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("empty git diff");
  });

  it("throws RuntimeError for unsupported declared outputs before shell calls", async () => {
    const { artifacts, input } = await fixture();
    input.declaredOutputs = ["RepoMap"];
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({}, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow(
      "PiCliWorkerAdapter v1 only supports CandidatePatch output"
    );
    expect(shell.calls).toHaveLength(0);
  });

  it("throws RuntimeError for a destructive git diff command", async () => {
    const { artifacts, input } = await fixture();
    const shell = new FakeShell([ok("pi done"), ok(patch)]);
    const worker = new PiCliWorkerAdapter({ diffCommand: ["git", "reset", "--hard"] }, shell);

    await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
  });
});
