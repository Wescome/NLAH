import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEnv, AdapterResult } from "../src/adapters.js";
import { ArtifactManager } from "../src/artifacts.js";
import { RuntimeError } from "../src/errors.js";
import type { LoomDomainConfig } from "../src/loom_cli_worker.js";
import { LoomCliWorkerAdapter } from "../src/loom_cli_worker.js";
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
  const root = await tempDir("nlah-loom-cli-worker-");
  const repo = path.join(root, "repo");
  await mkdir(repo, { recursive: true });
  const artifacts = new ArtifactManager(root, validSpec());
  const state: RuntimeState = {
    runId: "loom-cli-worker-test",
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

describe("LoomCliWorkerAdapter", () => {
  describe("prompt file generation", () => {
    it("writes the prompt file with task text, role, domain, and input artifacts", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await worker.execute(input, artifacts);

      const promptPath = path.join(root, "worker_prompts", "PATCH.loom.md");
      await expect(stat(promptPath)).resolves.toBeTruthy();
      const prompt = await readFile(promptPath, "utf8");
      expect(prompt).toContain("# NLAH Loom Stage Prompt");
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

    it("includes domain config section in prompt when provided", async () => {
      const { artifacts, input, root } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "code",
        promptTemplate: "You are a code amendment engine.",
        contextGlobs: ["src/**/*.ts", "test/**/*.ts"],
        constraints: ["Do not modify test files.", "Preserve existing API signatures."]
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).toContain("## Domain\ncode");
      expect(prompt).toContain("## Domain Instructions");
      expect(prompt).toContain("You are a code amendment engine.");
      expect(prompt).toContain("## Context Scope");
      expect(prompt).toContain("- src/**/*.ts");
      expect(prompt).toContain("- test/**/*.ts");
      expect(prompt).toContain("## Domain Constraints");
      expect(prompt).toContain("- Do not modify test files.");
      expect(prompt).toContain("- Preserve existing API signatures.");
    });

    it("omits optional domain sections when not configured", async () => {
      const { artifacts, input, root } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "management"
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).toContain("## Domain\nmanagement");
      expect(prompt).not.toContain("## Domain Instructions");
      expect(prompt).not.toContain("## Context Scope");
      expect(prompt).not.toContain("## Domain Constraints");
    });

    it("normalizes common Unicode punctuation in the prompt file", async () => {
      const { artifacts, input, root } = await fixture();
      input.context = {
        taskText: "Fix add() so it returns “sum”.",
        roleText: "Use the repo style — keep it minimal.",
        inputArtifacts: {
          IssueContract: "Patch only this behavior…",
          RepoMap: "Relevant file: src/math.ts only"
        },
        outputArtifactPaths: {
          CandidatePatch: artifacts.resolve("CandidatePatch")
        }
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).toContain('Fix add() so it returns "sum".');
      expect(prompt).toContain("Use the repo style - keep it minimal.");
      expect(prompt).toContain("Patch only this behavior...");
      expect(prompt).toContain("Relevant file: src/math.ts only");
      expect(prompt).not.toContain("“");
      expect(prompt).not.toContain("”");
      expect(prompt).not.toContain("—");
      expect(prompt).not.toContain("…");
    });
  });

  describe("command building", () => {
    it("builds the default text-mode command", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);
      const promptPath = path.join(root, "worker_prompts", "PATCH.loom.md");

      await worker.execute(input, artifacts);

      expect(shell.calls[0]).toEqual({
        command: ["pi", "-p", `@${promptPath}`],
        cwd: input.state.repoPath,
        timeoutSeconds: 300
      });
      expect(shell.calls[0]?.command).not.toContain("--mode");
      expect(shell.calls[0]?.command).not.toContain("json");
    });

    it("builds the explicit text-mode command", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ mode: "text" }, shell);
      const promptPath = path.join(root, "worker_prompts", "PATCH.loom.md");

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.command).toEqual(["pi", "-p", `@${promptPath}`]);
    });

    it("builds the json-mode command", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ mode: "json" }, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.command).toEqual([
        "pi",
        "-p",
        "--mode",
        "json",
        `@${path.join(root, "worker_prompts", "PATCH.loom.md")}`
      ]);
    });

    it("uses a custom command when configured", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ command: "custom-pi" }, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.command[0]).toBe("custom-pi");
    });

    it("appends extra args after prompt path", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ extraArgs: ["--some-flag", "--verbose"] }, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.command).toEqual([
        "pi",
        "-p",
        `@${path.join(root, "worker_prompts", "PATCH.loom.md")}`,
        "--some-flag",
        "--verbose"
      ]);
    });

    it("throws RuntimeError when command is empty string", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ command: "  " }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("pi command must not be empty");
    });
  });

  describe("environment and timeout", () => {
    it("passes configured environment to Pi command only", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const env = { LOOM_DOMAIN: "code" };
      const worker = new LoomCliWorkerAdapter({ env }, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.env).toEqual(env);
      expect(shell.calls[1]?.env).toBeUndefined();
    });

    it("uses configured timeout for both Pi and diff commands", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ timeoutSeconds: 600 }, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[0]?.timeoutSeconds).toBe(600);
      expect(shell.calls[1]?.timeoutSeconds).toBe(600);
    });
  });

  describe("diff capture and artifact writing", () => {
    it("runs diff after Pi, writes CandidatePatch, and returns created artifact plus message", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "diff", "--", "src/math.ts"] }, shell);

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
        message: "loom done"
      });
    });

    it("writes to configured artifact type when domainConfig.outputArtifactType is set", async () => {
      const { artifacts, input } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "code",
        outputArtifactType: "CandidatePatch"
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      const result = await worker.execute(input, artifacts);

      expect(result.createdArtifacts).toEqual(["CandidatePatch"]);
      await expect(readFile(artifacts.resolve("CandidatePatch"), "utf8")).resolves.toBe(patch);
    });

    it("uses the default diff command when none is configured", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await worker.execute(input, artifacts);

      expect(shell.calls[1]?.command).toEqual(["git", "diff", "--", "src"]);
    });
  });

  describe("error handling", () => {
    it("throws RuntimeError for a failed Pi command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([fail("pi failed", 2, "pi stdout")]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("loom pi command failed");
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
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("timed out: true");
    });

    it("writes Loom debug artifacts when the command fails", async () => {
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
      const worker = new LoomCliWorkerAdapter({ mode: "json" }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow(`debug: ${path.join(root, "debug")}`);

      const command = JSON.parse(await readFile(path.join(root, "debug", "loom.command.json"), "utf8")) as {
        command: string[];
      };
      const result = JSON.parse(await readFile(path.join(root, "debug", "loom.result.json"), "utf8")) as AdapterResult;

      expect(command.command).toEqual([
        "pi",
        "-p",
        "--mode",
        "json",
        `@${path.join(root, "worker_prompts", "PATCH.loom.md")}`
      ]);
      await expect(readFile(path.join(root, "debug", "loom.stdout"), "utf8")).resolves.toBe(
        '{"type":"session_start"}\n'
      );
      await expect(readFile(path.join(root, "debug", "loom.stderr"), "utf8")).resolves.toBe("timed out");
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

    it("writes diff debug artifacts when Loom exits without a diff", async () => {
      const { artifacts, input, root } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok("   \n")]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("empty git diff");

      await expect(readFile(path.join(root, "debug", "loom.stdout"), "utf8")).resolves.toBe("loom done");
      await expect(readFile(path.join(root, "debug", "loom.diff_stdout"), "utf8")).resolves.toBe("   \n");
      const diffCommand = JSON.parse(await readFile(path.join(root, "debug", "loom.diff_command.json"), "utf8")) as {
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
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("signal: SIGTERM");
    });

    it("throws RuntimeError for a failed diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), fail("diff failed", 3, "diff stdout")]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("loom diff command failed");
      expect(shell.calls).toHaveLength(2);
    });

    it("throws RuntimeError for an empty git diff", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok("   \n")]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("empty git diff");
    });

    it("throws RuntimeError for zero declared outputs before shell calls", async () => {
      const { artifacts, input } = await fixture();
      input.declaredOutputs = [];
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow(
        "LoomCliWorkerAdapter only supports single-artifact output"
      );
      expect(shell.calls).toHaveLength(0);
    });

    it("throws RuntimeError for multiple declared outputs", async () => {
      const { artifacts, input } = await fixture();
      input.declaredOutputs = ["CandidatePatch", "RepoMap"];
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({}, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow(
        "LoomCliWorkerAdapter only supports single-artifact output"
      );
      expect(shell.calls).toHaveLength(0);
    });
  });

  describe("destructive command rejection", () => {
    it("throws RuntimeError for a destructive git diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "reset", "--hard"] }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
    });

    it("rejects git push in diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "push"] }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
    });

    it("rejects git checkout in diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "checkout", "."] }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
    });

    it("rejects git clean in diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "clean", "-fd"] }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
    });

    it("rejects git commit in diff command", async () => {
      const { artifacts, input } = await fixture();
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ diffCommand: ["git", "commit", "-m", "msg"] }, shell);

      await expect(worker.execute(input, artifacts)).rejects.toThrow("destructive git operation");
    });
  });

  describe("domain configurations", () => {
    it("works with science domain config", async () => {
      const { artifacts, input, root } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "science",
        promptTemplate: "You are a scientific manuscript amendment engine.",
        contextGlobs: ["papers/**/*.tex"],
        outputArtifactType: "CandidatePatch",
        diffStrategy: "document",
        constraints: ["Preserve citation integrity.", "Do not alter methodology sections without explicit instruction."]
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).toContain("## Domain\nscience");
      expect(prompt).toContain("scientific manuscript amendment engine");
      expect(prompt).toContain("- papers/**/*.tex");
      expect(prompt).toContain("## Diff Strategy\ndocument");
      expect(prompt).toContain("- Preserve citation integrity.");
      expect(prompt).toContain("- Do not alter methodology sections without explicit instruction.");
    });

    it("includes diff strategy in prompt when configured", async () => {
      const { artifacts, input, root } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "code",
        diffStrategy: "structured"
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).toContain("## Diff Strategy\nstructured");
    });

    it("omits diff strategy section when not configured", async () => {
      const { artifacts, input, root } = await fixture();
      const domainConfig: LoomDomainConfig = {
        domain: "code"
      };
      const shell = new FakeShell([ok("loom done"), ok(patch)]);
      const worker = new LoomCliWorkerAdapter({ domainConfig }, shell);

      await worker.execute(input, artifacts);

      const prompt = await readFile(path.join(root, "worker_prompts", "PATCH.loom.md"), "utf8");
      expect(prompt).not.toContain("## Diff Strategy");
    });
  });
});
