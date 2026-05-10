import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import type { AdapterEnv, AdapterResult } from "../src/adapters.js";
import { runHarness } from "../src/runtime.js";
import { createPiPatchDemoRegistry, runPiPatchDemo } from "../examples/pi_patch_demo.js";
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

function ok(stdout: string): AdapterResult {
  return {
    ok: true,
    returncode: 0,
    stdout,
    stderr: ""
  };
}

async function writePiPatchHarness(root: string): Promise<string> {
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
  source.stages.PATCH.worker = "pi";

  const harnessPath = path.join(harnessRoot, "crew.pi_patch.yaml");
  await writeFile(harnessPath, YAML.stringify(source), "utf8");
  return harnessPath;
}

describe("pi PATCH runtime demo", () => {
  it("refuses the manual demo when NLAH_RUN_REAL_PI is not set", async () => {
    const previousEnv = process.env.NLAH_RUN_REAL_PI;
    const previousExitCode = process.exitCode;
    const previousError = console.error;
    const messages: string[] = [];

    delete process.env.NLAH_RUN_REAL_PI;
    console.error = (...args: unknown[]) => {
      messages.push(args.map(String).join(" "));
    };

    try {
      await runPiPatchDemo();

      expect(process.exitCode).toBe(1);
      expect(messages.join("\n")).toContain("Refusing to run real Pi. Set NLAH_RUN_REAL_PI=1 to run this demo.");
    } finally {
      if (previousEnv === undefined) {
        delete process.env.NLAH_RUN_REAL_PI;
      } else {
        process.env.NLAH_RUN_REAL_PI = previousEnv;
      }
      process.exitCode = previousExitCode;
      console.error = previousError;
    }
  });

  it("executes PATCH through PiCliWorkerAdapter while other stages use deterministic workers", async () => {
    const root = await tempDir("nlah-pi-patch-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const harnessPath = await writePiPatchHarness(root);
    const fakeShell = new FakeShell([ok("pi PATCH complete"), ok(mathPatch)]);
    const previousOfoxApiKey = process.env.OFOX_API_KEY;
    process.env.OFOX_API_KEY = "\u201Cofx-runtime-test\u201D";
    const workerRegistry = createPiPatchDemoRegistry(fakeShell);
    const cwd = process.cwd();

    process.chdir(root);
    try {
      const result = await runHarness(harnessPath, repo, taskPath, {
        runId: "pi-patch-runtime-test",
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

      const promptPath = path.join(result.runRoot, "worker_prompts", "PATCH.pi.md");
      await expect(stat(promptPath)).resolves.toBeTruthy();
      const prompt = await readFile(promptPath, "utf8");
      expect(prompt).toContain("### IssueContract");
      expect(prompt).toContain("### RepoMap");

      expect(fakeShell.calls).toHaveLength(2);
      expect(fakeShell.calls[0]?.command.slice(0, 4)).toEqual(["pi", "-p", "--mode", "json"]);
      expect(fakeShell.calls[0]?.command).toContain(`@${promptPath}`);
      expect(fakeShell.calls[0]?.command).toContain("--no-session");
      expect(fakeShell.calls[0]?.command).toContain("--no-context-files");
      expect(fakeShell.calls[0]?.command).toContain("--tools");
      const apiKeyIndex = fakeShell.calls[0]?.command.indexOf("--api-key") ?? -1;
      expect(apiKeyIndex).toBeGreaterThan(-1);
      expect(fakeShell.calls[0]?.command[apiKeyIndex + 1]).toBe("ofx-runtime-test");
      expect(fakeShell.calls[0]?.command).not.toContain(promptPath);
      const openAiKey = fakeShell.calls[0]?.env?.OPENAI_API_KEY ?? "";
      expect(openAiKey).not.toContain("\u201C");
      expect(openAiKey).not.toContain("\u201D");
      expect(fakeShell.calls[0]?.cwd).toBe(repo);
      expect(fakeShell.calls[0]?.timeoutSeconds).toBe(300);
      expect(fakeShell.calls[1]?.command[0]).toBe("git");
    } finally {
      if (previousOfoxApiKey === undefined) {
        delete process.env.OFOX_API_KEY;
      } else {
        process.env.OFOX_API_KEY = previousOfoxApiKey;
      }
      process.chdir(cwd);
    }
  }, 30000);
});
