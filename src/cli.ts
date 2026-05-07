#!/usr/bin/env node
import { Command } from "commander";
import { runHarness } from "./runtime";

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
  .action(async (options: { harness: string; repo: string; task: string; runId?: string }) => {
    const result = await runHarness(options.harness, options.repo, options.task, options.runId);
    console.log(`Run ID: ${result.runId}`);
    console.log(`Status: ${result.status}`);
    console.log(`State: ${result.state}`);
    console.log("Artifacts:");
    for (const artifact of result.artifacts) {
      console.log(`  - ${artifact}`);
    }
    console.log(`Trace: ${result.tracePath}`);
    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
