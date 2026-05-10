import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterEnv, AdapterResult } from "./adapters.js";
import { ShellAdapter } from "./adapters.js";
import type { ArtifactManager } from "./artifacts.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type PiCliWorkerMode = "print" | "json";

export type PiCliWorkerConfig = {
  command?: string;
  mode?: PiCliWorkerMode;
  extraArgs?: string[];
  timeoutSeconds?: number;
  diffCommand?: string[];
  env?: AdapterEnv;
};

type ShellRunner = {
  run(command: string[], cwd: string, timeoutSeconds?: number, env?: AdapterEnv): Promise<AdapterResult>;
};

export class PiCliWorkerAdapter implements WorkerAdapter {
  constructor(
    private readonly config: PiCliWorkerConfig = {},
    private readonly shell: ShellRunner = new ShellAdapter()
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    if (input.declaredOutputs.length !== 1 || input.declaredOutputs[0] !== "CandidatePatch") {
      throw new RuntimeError("PiCliWorkerAdapter v1 only supports CandidatePatch output");
    }

    const promptPath = path.join(input.state.runRoot, "worker_prompts", `${input.stageName}.pi.md`);
    const prompt = normalizePiPromptText(buildPiPrompt(input));
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, prompt, "utf8");

    const timeoutSeconds = this.config.timeoutSeconds ?? 300;
    const piCommand = this.buildPiCommand(promptPath);
    const piResult = await this.shell.run(piCommand, input.state.repoPath, timeoutSeconds, this.config.env);

    if (!piResult.ok) {
      throw new RuntimeError(formatCommandFailure("pi command failed", piCommand, piResult));
    }

    const diffCommand = this.config.diffCommand ?? ["git", "diff", "--", "src"];
    validateCommand(diffCommand, "diff command");
    rejectDestructiveGitCommand(diffCommand, "diff command");

    const diffResult = await this.shell.run(diffCommand, input.state.repoPath, timeoutSeconds);
    if (!diffResult.ok) {
      throw new RuntimeError(formatCommandFailure("pi diff command failed", diffCommand, diffResult));
    }

    if (!diffResult.stdout.trim()) {
      throw new RuntimeError("empty git diff");
    }

    await artifacts.writeText("CandidatePatch", diffResult.stdout);

    return {
      createdArtifacts: ["CandidatePatch"],
      message: piResult.stdout
    };
  }

  private buildPiCommand(promptPath: string): string[] {
    const command = this.config.command ?? "pi";
    if (!command.trim()) {
      throw new RuntimeError("pi command must not be empty");
    }

    const mode = this.config.mode ?? "print";
    const result =
      mode === "json"
        ? [command, "-p", promptPath, "--mode", "json", ...(this.config.extraArgs ?? [])]
        : [command, "-p", promptPath, ...(this.config.extraArgs ?? [])];

    validateCommand(result, "pi command");
    rejectDestructiveGitCommand(result, "pi command");
    return result;
  }
}

function buildPiPrompt(input: WorkerInput): string {
  const sections = [
    "# NLAH Pi Stage Prompt",
    "",
    "## Stage",
    input.stageName,
    "",
    "## Role",
    input.roleName,
    "",
    "## Task",
    input.context.taskText
  ];

  if (input.context.roleText) {
    sections.push("", "## Role Policy", input.context.roleText);
  }

  sections.push("", "## Input Artifacts");
  for (const [name, content] of Object.entries(input.context.inputArtifacts)) {
    sections.push("", `### ${name}`, content);
  }

  sections.push(
    "",
    "## Declared Outputs",
    ...input.declaredOutputs.map((output) => `- ${output}`),
    "",
    "## Instructions",
    "Produce the smallest correct repository change for this stage.",
    "Do not commit.",
    "Do not push.",
    "Do not perform destructive git operations.",
    "Do not modify files unrelated to the task.",
    "When finished, leave repository changes unstaged so NLAH can capture git diff."
  );

  return `${sections.join("\n")}\n`;
}

function normalizePiPromptText(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

function validateCommand(command: string[], label: string): void {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) {
    throw new RuntimeError(`${label} must be a non-empty string[]`);
  }
}

function rejectDestructiveGitCommand(command: string[], label: string): void {
  if (command[0] !== "git") {
    return;
  }

  const subcommand = command[1];
  if (subcommand && ["checkout", "clean", "commit", "push", "reset"].includes(subcommand)) {
    throw new RuntimeError(`${label} must not run destructive git operation: git ${subcommand}`);
  }
}

function formatCommandFailure(label: string, command: string[], result: AdapterResult): string {
  return [
    label,
    `command: ${command.join(" ")}`,
    `exit: ${result.returncode}`,
    result.stderr ? `stderr: ${result.stderr}` : "",
    result.stdout ? `stdout: ${result.stdout}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
