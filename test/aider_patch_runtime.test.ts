import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { AdapterResult } from "../src/adapters.js";
import { runHarness } from "../src/runtime.js";
import { createAiderPatchDemoRegistry, runAiderPatchDemo } from "../examples/aider_patch_demo.js";
import { createTargetRepo, tempDir } from "./helpers.js";

const mathPatch = [
  "diff --git a/src/math.ts b/src/math.ts",
  "index 0000000..0000001 100644",
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
};

class FakeShell {
  readonly calls: ShellCall[] = [];

  constructor(private readonly responses: AdapterResult[]) {}

  async run(command: string[], cwd: string, timeoutSeconds?: number): Promise<AdapterResult> {
    this.calls.push({
      command,
      cwd,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds })
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

function ok(stdout: string): AdapterResult {
  return {
    ok: true,
    returncode: 0,
    stdout,
    stderr: ""
  };
}

async function writeAiderPatchHarness(root: string): Promise<string> {
  const harnessRoot = path.join(root, "harnesses");
  await mkdir(harnessRoot, { recursive: true });
  await cp(path.resolve("roles"), path.join(root, "roles"), { recursive: true });

  const source = YAML.parse(await readFile(path.resolve("harnesses/crew.mvp.yaml"), "utf8")) as {
    stages: {
      PATCH: {
        worker?: string;
      };
    };
  };
  source.stages.PATCH.worker = "aider";

  const harnessPath = path.join(harnessRoot, "crew.aider_patch.yaml");
  await writeFile(harnessPath, YAML.stringify(source), "utf8");
  return harnessPath;
}

describe("aider PATCH runtime demo", () => {
  it("refuses the manual demo when NLAH_RUN_REAL_AIDER is not set", async () => {
    const previousEnv = process.env.NLAH_RUN_REAL_AIDER;
    const previousExitCode = process.exitCode;
    const previousError = console.error;
    const messages: string[] = [];

    delete process.env.NLAH_RUN_REAL_AIDER;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };

    try {
      await runAiderPatchDemo();

      expect(process.exitCode).toBe(1);
      expect(messages.join("\n")).toContain(
        "Refusing to run real Aider. Set NLAH_RUN_REAL_AIDER=1 to run this demo."
      );
    } finally {
      if (previousEnv === undefined) {
        delete process.env.NLAH_RUN_REAL_AIDER;
      } else {
        process.env.NLAH_RUN_REAL_AIDER = previousEnv;
      }
      process.exitCode = previousExitCode;
      console.error = previousError;
    }
  });

  it("executes PATCH through AiderCliWorkerAdapter while other stages use deterministic workers", async () => {
    const root = await tempDir("nlah-aider-patch-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const harnessPath = await writeAiderPatchHarness(root);
    const fakeShell = new FakeShell([ok("aider PATCH complete"), ok(mathPatch)]);
    const workerRegistry = createAiderPatchDemoRegistry(fakeShell);
    const cwd = process.cwd();

    process.chdir(root);
    try {
      const result = await runHarness(harnessPath, repo, taskPath, {
        runId: "aider-patch-runtime-test",
        workerRegistry
      });

      expect(result.status).toBe("PASS");

      await expect(stat(path.join(result.artifactRoot, "final.patch"))).resolves.toBeTruthy();
      const candidatePatch = await readFile(path.join(result.artifactRoot, "candidate.patch"), "utf8");
      expect(candidatePatch).toContain("return a + b;");

      const trace = await readFile(result.tracePath, "utf8");
      const traceEvents = trace
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string; stage?: string });
      expect(traceEvents).toContainEqual(expect.objectContaining({ event: "worker_completed", stage: "PATCH" }));

      const promptPath = path.join(result.runRoot, "worker_prompts", "PATCH.md");
      await expect(stat(promptPath)).resolves.toBeTruthy();
      const prompt = await readFile(promptPath, "utf8");
      expect(prompt).toContain("### IssueContract");
      expect(prompt).toContain("### RepoMap");

      expect(fakeShell.calls).toHaveLength(2);
      expect(fakeShell.calls[0]?.command[0]).toBe("aider");
      expect(fakeShell.calls[0]?.command).toContain("--no-auto-commits");
      expect(fakeShell.calls[1]?.command[0]).toBe("git");
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});
