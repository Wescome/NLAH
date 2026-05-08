#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { RuntimeError } from "./errors.js";
import { buildCrewManifestFromFile, type CrewManifest } from "./manifest.js";
import { runHarness, type RunHarnessOptions } from "./runtime.js";
import type { RuntimeResult } from "./state.js";
import { validateHarnessFile, type ValidationReport } from "./validator.js";
import { WorkerRegistry } from "./worker_registry.js";

export function formatRunResultText(result: RuntimeResult): string {
  const lines = [
    `Run ID: ${result.runId}`,
    `Status: ${result.status}`,
    `State: ${result.finalState}`,
    `Artifacts: ${result.artifactRoot}`,
    `Trace: ${result.tracePath}`,
    `Summary: ${result.summaryPath}`
  ];

  if (result.message) {
    lines.push(`Message: ${result.message}`);
  }

  return lines.join("\n");
}

export function formatRunResultJson(result: RuntimeResult): string {
  return JSON.stringify(result);
}

export function formatValidationReportText(report: ValidationReport): string {
  const lines = [`Harness: ${report.harnessPath}`, `Status: ${report.status}`];

  if (report.status === "VALID") {
    if (report.stageOrder) {
      lines.push(`Stage Order: ${report.stageOrder.join(" -> ")}`);
    }
    if (report.startState) {
      lines.push(`Start State: ${report.startState}`);
    }
    if (report.terminalStates) {
      lines.push(`Terminal States: ${report.terminalStates.join(", ")}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push("Errors:");
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join("\n");
}

export function formatValidationReportJson(report: ValidationReport): string {
  return JSON.stringify(report);
}

export function formatCrewManifestText(manifest: CrewManifest): string {
  const lines = [
    `Crew: ${manifest.harnessName}`,
    `Task Family: ${manifest.taskFamily}`,
    `Stage Order: ${manifest.stageOrder.join(" -> ")}`,
    "Stages:"
  ];

  for (const stage of manifest.stages) {
    const worker = stage.worker === undefined ? "" : ` | worker=${stage.worker}`;
    lines.push(
      `- ${stage.name}: ${stage.from} -> ${stage.to} | role=${stage.role}${worker} | inputs=[${stage.inputs.join(", ")}] | outputs=[${stage.outputs.join(", ")}]`
    );
  }

  return lines.join("\n");
}

export function formatCrewManifestJson(manifest: CrewManifest): string {
  return JSON.stringify(manifest);
}

export function createCliWorkerRegistry(workerName?: string): WorkerRegistry | undefined {
  if (workerName === undefined) {
    return undefined;
  }

  if (workerName === "deterministic") {
    return new WorkerRegistry({ defaultWorker: "deterministic" });
  }

  throw new RuntimeError(`unsupported CLI worker: ${workerName}`);
}

export function buildRunHarnessOptions(args: {
  runId?: string;
  worker?: string;
  overwriteRun?: boolean;
}): string | RunHarnessOptions | undefined {
  const workerRegistry = createCliWorkerRegistry(args.worker);
  const overwriteRun = args.overwriteRun ?? false;

  if (!workerRegistry && !overwriteRun) {
    return args.runId;
  }

  return {
    ...(args.runId === undefined ? {} : { runId: args.runId }),
    ...(workerRegistry === undefined ? {} : { workerRegistry }),
    ...(overwriteRun ? { overwriteRun: true } : {})
  };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("nlah")
    .description("Natural-Language Agent Harness runtime")
    .version("0.1.0");

  program
    .command("run")
    .requiredOption("--harness <path>", "Harness YAML path")
    .requiredOption("--repo <path>", "Target repository path")
    .requiredOption("--task <path>", "Task file path")
    .option("--run-id <id>", "Run identifier")
    .option("--worker <name>", "Worker adapter name")
    .option("--overwrite-run", "Delete an existing run directory before starting")
    .option("--json", "Print RuntimeResult as JSON")
    .action(
      async (options: {
        harness: string;
        repo: string;
        task: string;
        runId?: string;
        worker?: string;
        overwriteRun?: boolean;
        json?: boolean;
      }) => {
        const runOptions = buildRunHarnessOptions({
          ...(options.runId === undefined ? {} : { runId: options.runId }),
          ...(options.worker === undefined ? {} : { worker: options.worker }),
          ...(options.overwriteRun === undefined ? {} : { overwriteRun: options.overwriteRun })
        });
        const result = await runHarness(options.harness, options.repo, options.task, runOptions);
        console.log(options.json ? formatRunResultJson(result) : formatRunResultText(result));
        process.exitCode = result.status === "PASS" ? 0 : 1;
      }
    );

  program
    .command("validate")
    .requiredOption("--harness <path>", "Harness YAML path")
    .option("--json", "Print validation report as JSON")
    .action(async (options: { harness: string; json?: boolean }) => {
      const report = await validateHarnessFile(options.harness);
      console.log(options.json ? formatValidationReportJson(report) : formatValidationReportText(report));
      process.exitCode = report.status === "VALID" ? 0 : 1;
    });

  program
    .command("manifest")
    .requiredOption("--harness <path>", "Harness YAML path")
    .option("--json", "Print crew manifest as JSON")
    .action(async (options: { harness: string; json?: boolean }) => {
      const manifest = await buildCrewManifestFromFile(options.harness);
      console.log(options.json ? formatCrewManifestJson(manifest) : formatCrewManifestText(manifest));
      process.exitCode = 0;
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
const currentModule = fileURLToPath(import.meta.url);

if (entrypoint === currentModule) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
