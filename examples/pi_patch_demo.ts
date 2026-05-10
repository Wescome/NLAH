import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { ShellAdapter } from "../src/adapters.js";
import { PiCliWorkerAdapter } from "../src/pi_cli_worker.js";
import { checkPiAvailable } from "../src/pi_preflight.js";
import { runHarness } from "../src/runtime.js";
import { DeterministicWorkerAdapter } from "../src/workers.js";
import { WorkerRegistry } from "../src/worker_registry.js";

type ShellRunner = Pick<ShellAdapter, "run">;

export function createPiPatchDemoRegistry(shell?: ShellRunner): WorkerRegistry {
  const deterministicWorker = new DeterministicWorkerAdapter();
  const piWorker = new PiCliWorkerAdapter(
    {
      command: "pi",
      mode: "print",
      timeoutSeconds: 300
    },
    shell
  );

  return new WorkerRegistry({
    defaultWorker: "deterministic",
    workers: {
      deterministic: deterministicWorker,
      pi: piWorker
    }
  });
}

async function writePiPatchHarness(sourcePath: string, targetPath: string): Promise<void> {
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

  root.stages.PATCH.worker = "pi";
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp("roles", path.resolve(path.dirname(targetPath), "..", "roles"), { recursive: true });
  await writeFile(targetPath, YAML.stringify(root), "utf8");
}

export async function runPiPatchDemo(): Promise<void> {
  if (process.env.NLAH_RUN_REAL_PI !== "1") {
    console.error("Refusing to run real Pi. Set NLAH_RUN_REAL_PI=1 to run this demo.");
    process.exitCode = 1;
    return;
  }

  const preflight = await checkPiAvailable();
  if (!preflight.ok) {
    console.error(
      [
        `Pi CLI is not available: ${preflight.message}`,
        "Install Pi manually, then verify it:",
        "pi --version"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const harnessPath = path.resolve("runs", "pi-patch-demo-harness", "harnesses", "crew.pi_patch.yaml");
  await writePiPatchHarness("harnesses/crew.mvp.yaml", harnessPath);

  const result = await runHarness(harnessPath, "examples/target_repo_stub", "examples/TASK.md", {
    runId: "pi-patch-demo",
    workerRegistry: createPiPatchDemoRegistry(),
    overwriteRun: true
  });
  console.log(JSON.stringify(result, null, 2));
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  runPiPatchDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
