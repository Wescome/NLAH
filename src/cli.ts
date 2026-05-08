#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runHarness } from "./runtime.js";
import type { RuntimeResult } from "./state.js";

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
    .option("--json", "Print RuntimeResult as JSON")
    .action(async (options: { harness: string; repo: string; task: string; runId?: string; json?: boolean }) => {
      const result = await runHarness(options.harness, options.repo, options.task, options.runId);
      console.log(options.json ? formatRunResultJson(result) : formatRunResultText(result));
      process.exitCode = result.status === "PASS" ? 0 : 1;
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
