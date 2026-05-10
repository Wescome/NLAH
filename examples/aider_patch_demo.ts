import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { AiderCliWorkerAdapter } from "../src/aider_cli_worker.js";
import { checkAiderAvailable } from "../src/aider_preflight.js";
import type { ShellAdapter } from "../src/adapters.js";
import { runHarness } from "../src/runtime.js";
import { DeterministicWorkerAdapter } from "../src/workers.js";
import { WorkerRegistry } from "../src/worker_registry.js";

type ShellRunner = Pick<ShellAdapter, "run">;

export function createAiderPatchDemoRegistry(shell?: ShellRunner): WorkerRegistry {
  const deterministicWorker = new DeterministicWorkerAdapter();
  const aiderWorker = new AiderCliWorkerAdapter(
    {
      command: "aider",
      extraArgs: [
        "--yes",
        "--no-auto-commits",
        "--no-gitignore",
        "--map-tokens",
        "0",
        "--no-restore-chat-history"
      ],
      timeoutSeconds: 120,
      env: {
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        LC_ALL: "en_US.UTF-8",
        LANG: "en_US.UTF-8"
      }
    },
    shell
  );

  return new WorkerRegistry({
    defaultWorker: "deterministic",
    workers: {
      deterministic: deterministicWorker,
      aider: aiderWorker
    }
  });
}

async function writeAiderPatchHarness(sourcePath: string, targetPath: string): Promise<void> {
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

  root.stages.PATCH.worker = "aider";
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp("roles", path.resolve(path.dirname(targetPath), "..", "roles"), { recursive: true });
  await writeFile(targetPath, YAML.stringify(root), "utf8");
}

export async function runAiderPatchDemo(): Promise<void> {
  if (process.env.NLAH_RUN_REAL_AIDER !== "1") {
    console.error("Refusing to run real Aider. Set NLAH_RUN_REAL_AIDER=1 to run this demo.");
    process.exitCode = 1;
    return;
  }

  const preflight = await checkAiderAvailable();
  if (!preflight.ok) {
    console.error(
      [
        `Aider CLI is not available: ${preflight.message}`,
        "Install Aider manually, then verify it:",
        "python -m pip install aider-chat",
        "aider --version"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const harnessPath = path.resolve("runs", "aider-patch-demo-harness", "harnesses", "crew.aider_patch.yaml");
  await writeAiderPatchHarness("harnesses/crew.mvp.yaml", harnessPath);

  const result = await runHarness(harnessPath, "examples/target_repo_stub", "examples/TASK.md", {
    runId: "aider-patch-demo",
    workerRegistry: createAiderPatchDemoRegistry(),
    overwriteRun: true
  });
  console.log(JSON.stringify(result, null, 2));
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  runAiderPatchDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
