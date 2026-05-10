import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { ShellAdapter } from "../src/adapters.js";
import { loadLocalCredentialEnv, sanitizedCredentialEnv, sanitizeCredentialValue } from "../src/credential_env.js";
import { PiCliWorkerAdapter } from "../src/pi_cli_worker.js";
import { checkPiAvailable } from "../src/pi_preflight.js";
import { runHarness } from "../src/runtime.js";
import { DeterministicWorkerAdapter } from "../src/workers.js";
import { WorkerRegistry } from "../src/worker_registry.js";

type ShellRunner = Pick<ShellAdapter, "run">;

export type PiPatchDemoRegistryOptions = {
  piAgentDir?: string;
};

export function createPiPatchDemoRegistry(shell?: ShellRunner, options: PiPatchDemoRegistryOptions = {}): WorkerRegistry {
  const deterministicWorker = new DeterministicWorkerAdapter();
  const model = process.env.NLAH_PI_MODEL ?? (process.env.OFOX_API_KEY ? "ofox/openai/gpt-5.4" : "openai/gpt-4o-mini");
  const apiKeyArgs = buildApiKeyArgs();
  const piWorker = new PiCliWorkerAdapter(
    {
      command: "pi",
      mode: "json",
      extraArgs: [
        "--model",
        model,
        ...apiKeyArgs,
        "--no-session",
        "--no-context-files",
        "--tools",
        "read,edit,write,grep,find,ls"
      ],
      env: {
        ...sanitizedCredentialEnv(),
        ...(options.piAgentDir ? { PI_CODING_AGENT_DIR: options.piAgentDir } : {})
      },
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

function buildApiKeyArgs(): string[] {
  const apiKey = process.env.NLAH_PI_API_KEY ?? process.env.OFOX_API_KEY;
  return apiKey ? ["--api-key", sanitizeCredentialValue(apiKey)] : [];
}

async function prepareOfoxPiAgentDir(agentDir: string): Promise<string | undefined> {
  if (!process.env.OFOX_API_KEY) {
    return undefined;
  }

  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          ofox: {
            baseUrl: "https://api.ofox.ai/v1",
            api: "openai-completions",
            apiKey: "OFOX_API_KEY",
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
              maxTokensField: "max_tokens"
            },
            models: [
              {
                id: "openai/gpt-5.4",
                name: "OFOX GPT-5.4",
                reasoning: false,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 16384,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0
                }
              }
            ]
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return agentDir;
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

  await loadLocalCredentialEnv();

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
  const piAgentDir = await prepareOfoxPiAgentDir(path.resolve("runs", "pi-patch-demo-pi-agent"));

  const result = await runHarness(harnessPath, "examples/target_repo_stub", "examples/TASK.md", {
    runId: "pi-patch-demo",
    workerRegistry: createPiPatchDemoRegistry(undefined, piAgentDir ? { piAgentDir } : {}),
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
