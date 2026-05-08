import { describe, expect, it } from "vitest";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { runHarness } from "../src/runtime.js";
import type { ArtifactManager } from "../src/artifacts.js";
import { DeterministicWorkerAdapter, type WorkerAdapter, type WorkerInput, type WorkerOutput } from "../src/workers.js";
import { WorkerRegistry } from "../src/worker_registry.js";
import { createTargetRepo, tempDir, validSpec } from "./helpers.js";

describe("runtime", () => {
  it("executes the MVP harness to PASS with required files and trace events", async () => {
    const root = await tempDir("nlah-runtime-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const result = await runHarness(
        path.join(cwd, "harnesses/coding_swarm.mvp.yaml"),
        repo,
        taskPath,
        "runtime-test"
      );

      expect(result.status).toBe("PASS");
      expect(result.finalState).toBe("PullRequestReady");
      await expect(stat(path.join(result.runRoot, "TASK.md"))).resolves.toBeTruthy();

      for (const artifact of [
        "issue_contract.md",
        "repo_map.md",
        "candidate.patch",
        "verifier_report.md",
        "final.patch",
        "pr_summary.md"
      ]) {
        await expect(stat(path.join(result.artifactRoot, artifact))).resolves.toBeTruthy();
      }

      const trace = await readFile(result.tracePath, "utf8");
      for (const event of [
        "run_started",
        "stage_started",
        "artifact_created",
        "gate_passed",
        "state_transition",
        "stage_completed",
        "run_completed"
      ]) {
        expect(trace).toContain(event);
      }
    } finally {
      process.chdir(cwd);
    }
  });

  it("uses a provided worker adapter", async () => {
    const root = await tempDir("nlah-runtime-worker-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    const calls: string[] = [];
    class RecordingWorker implements WorkerAdapter {
      private readonly deterministic = new DeterministicWorkerAdapter();

      async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
        calls.push(input.stageName);
        expect(input.context.taskText).toContain("Fix `add(a, b)`");
        expect(input.context.outputArtifactPaths).toBeDefined();
        return this.deterministic.execute(input, artifacts);
      }
    }

    process.chdir(root);
    try {
      const result = await runHarness(
        path.join(cwd, "harnesses/coding_swarm.mvp.yaml"),
        repo,
        taskPath,
        "runtime-worker-test",
        new RecordingWorker()
      );

      expect(result.status).toBe("PASS");
      expect(calls).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("allows a custom fake worker to create artifacts and pass through runtime", async () => {
    const root = await tempDir("nlah-runtime-fake-worker-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();

    class FakeWorker implements WorkerAdapter {
      async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
        const createdArtifacts: string[] = [];
        for (const output of input.declaredOutputs) {
          if (output === "IssueContract") {
            await artifacts.writeText(output, "# Issue Contract\n");
          } else if (output === "RepoMap") {
            await artifacts.writeText(
              output,
              "# Repo Map\n\n## Relevant files\n\n- src/math.ts\n\n## Relevant tests\n\n- test/math.test.ts\n"
            );
          } else if (output === "CandidatePatch") {
            await artifacts.writeText(
              output,
              [
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
              ].join("\n")
            );
          } else if (output === "VerifierReport") {
            await artifacts.writeText(output, "# Verifier Report\n\nTests run\n\nVerdict: PASS\n");
          } else if (output === "FinalPatch") {
            await artifacts.writeText(output, await artifacts.readText("CandidatePatch"));
          } else if (output === "PRSummary") {
            await artifacts.writeText(output, "# PR Summary\n\n- src/math.ts\n");
          }
          createdArtifacts.push(output);
        }
        return { createdArtifacts };
      }
    }

    process.chdir(root);
    try {
      const result = await runHarness(
        path.join(cwd, "harnesses/coding_swarm.mvp.yaml"),
        repo,
        taskPath,
        "runtime-fake-worker-test",
        new FakeWorker()
      );

      expect(result.status).toBe("PASS");
      await expect(readFile(path.join(result.artifactRoot, "pr_summary.md"), "utf8")).resolves.toContain("src/math.ts");
    } finally {
      process.chdir(cwd);
    }
  });

  it("uses workerRegistry default when no stage worker is specified", async () => {
    const root = await tempDir("nlah-runtime-registry-default-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const cwd = process.cwd();
    const calls: string[] = [];

    class RegistryDefaultWorker implements WorkerAdapter {
      private readonly deterministic = new DeterministicWorkerAdapter();

      async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
        calls.push(input.stageName);
        return this.deterministic.execute(input, artifacts);
      }
    }

    process.chdir(root);
    try {
      const result = await runHarness(
        path.join(cwd, "harnesses/coding_swarm.mvp.yaml"),
        repo,
        taskPath,
        {
          runId: "runtime-registry-default-test",
          workerRegistry: new WorkerRegistry({
            defaultWorker: "registryDefault",
            workers: { registryDefault: new RegistryDefaultWorker() }
          })
        }
      );

      expect(result.status).toBe("PASS");
      expect(calls).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("uses stage-specific worker when specified", async () => {
    const root = await tempDir("nlah-runtime-stage-worker-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const spec = validSpec();
    spec.stages.CONTRACT!.worker = "fake";
    const harnessPath = path.join(root, "harness.yaml");
    await writeFile(harnessPath, YAML.stringify(spec), "utf8");
    const cwd = process.cwd();
    const calls: string[] = [];

    class FakeStageWorker implements WorkerAdapter {
      private readonly deterministic = new DeterministicWorkerAdapter();

      async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
        calls.push(input.stageName);
        return this.deterministic.execute(input, artifacts);
      }
    }

    process.chdir(root);
    try {
      const result = await runHarness(harnessPath, repo, taskPath, {
        runId: "runtime-stage-worker-test",
        workerRegistry: new WorkerRegistry({ workers: { fake: new FakeStageWorker() } })
      });

      expect(result.status).toBe("PASS");
      expect(calls).toEqual(["CONTRACT"]);
    } finally {
      process.chdir(cwd);
    }
  });

  it("unknown stage worker returns FAIL result", async () => {
    const root = await tempDir("nlah-runtime-unknown-worker-");
    const repo = await createTargetRepo(root);
    const taskPath = path.join(root, "TASK.md");
    await cp(path.resolve("examples/TASK.md"), taskPath);
    const spec = validSpec();
    spec.stages.CONTRACT!.worker = "missing";
    const harnessPath = path.join(root, "harness.yaml");
    await writeFile(harnessPath, YAML.stringify(spec), "utf8");
    const cwd = process.cwd();

    process.chdir(root);
    try {
      const result = await runHarness(harnessPath, repo, taskPath, {
        runId: "runtime-unknown-worker-test",
        workerRegistry: new WorkerRegistry()
      });

      expect(result.status).toBe("FAIL");
      expect(result.message).toContain("unknown worker: missing");
    } finally {
      process.chdir(cwd);
    }
  });
});
