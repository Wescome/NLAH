import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { ShellAdapter } from "../src/adapters.js";
import { LoomCliWorkerAdapter } from "../src/loom_cli_worker.js";
import { checkPiAvailable } from "../src/pi_preflight.js";
import { runHarness } from "../src/runtime.js";
import { DeterministicWorkerAdapter } from "../src/workers.js";
import { WorkerRegistry } from "../src/worker_registry.js";

type ShellRunner = Pick<ShellAdapter, "run">;

export function createLoomPatchDemoRegistry(shell?: ShellRunner): WorkerRegistry {
  const deterministicWorker = new DeterministicWorkerAdapter();
  const loomWorker = new LoomCliWorkerAdapter(
    {
      command: "pi",
      mode: "json",
      timeoutSeconds: 300,
      domainConfig: {
        domain: "code",
        promptTemplate: "Use the NLAH stage context to produce the smallest correct code patch.",
        contextGlobs: ["src/**/*.ts", "test/**/*.ts"],
        outputArtifactType: "CandidatePatch",
        diffStrategy: "git",
        constraints: ["Do not commit.", "Do not push.", "Do not modify unrelated files."]
      }
    },
    shell
  );

  return new WorkerRegistry({
    defaultWorker: "deterministic",
    workers: {
      deterministic: deterministicWorker,
      loom: loomWorker
    }
  });
}

async function writeLoomPatchHarness(sourcePath: string, targetPath: string): Promise<void> {
  const document = YAML.parseDocument(await readFile(sourcePath, "utf8"));
  const root = document.toJSON() as {
    stages?: {
      PATCH?: {
        worker?: string;
      };
    };
  };
  if (!root.stages?.PATCH) {
    throw new Error("crew harness is missing PATCH stage");
  }

  root.stages.PATCH.worker = "loom";
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp("roles", path.resolve(path.dirname(targetPath), "..", "roles"), { recursive: true });
  await writeFile(targetPath, YAML.stringify(root), "utf8");
}

export async function runLoomPatchDemo(): Promise<void> {
  if (process.env.NLAH_RUN_REAL_LOOM !== "1") {
    console.error("Refusing to run real Loom. Set NLAH_RUN_REAL_LOOM=1 to run this demo.");
    process.exitCode = 1;
    return;
  }

  const preflight = await checkPiAvailable();
  if (!preflight.ok) {
    console.error(
      [
        `Pi CLI is not available for the Loom demo: ${preflight.message}`,
        "Install Pi manually, then verify it:",
        "pi --version"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const harnessPath = path.resolve("runs", "loom-patch-demo-harness", "harnesses", "crew.loom_patch.yaml");
  await writeLoomPatchHarness("harnesses/crew.mvp.yaml", harnessPath);

  const result = await runHarness(harnessPath, "examples/target_repo_stub", "examples/TASK.md", {
    runId: "loom-patch-demo",
    workerRegistry: createLoomPatchDemoRegistry(),
    overwriteRun: true
  });
  console.log(JSON.stringify(result, null, 2));
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  runLoomPatchDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
