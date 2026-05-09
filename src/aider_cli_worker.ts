import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactManager } from "./artifacts.js";
import { ShellAdapter, type AdapterResult } from "./adapters.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type AiderCliWorkerConfig = {
  command?: string;
  model?: string;
  extraArgs?: string[];
  timeoutSeconds?: number;
  diffCommand?: string[];
};

type ShellRunner = {
  run(command: string[], cwd: string, timeoutSeconds?: number): Promise<AdapterResult>;
};

export class AiderCliWorkerAdapter implements WorkerAdapter {
  constructor(
    private readonly config: AiderCliWorkerConfig = {},
    private readonly shell: ShellRunner = new ShellAdapter()
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    if (input.declaredOutputs.length !== 1 || input.declaredOutputs[0] !== "CandidatePatch") {
      throw new RuntimeError("AiderCliWorkerAdapter v1 only supports CandidatePatch output");
    }

    const promptPath = path.join(input.state.runRoot, "worker_prompts", `${input.stageName}.md`);
    const prompt = normalizeAiderPromptText(buildAiderPrompt(input));
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, prompt, "utf8");

    const command = this.buildAiderCommand(promptPath);
    const timeoutSeconds = this.config.timeoutSeconds ?? 300;
    const aiderResult = await this.shell.run(command, input.state.repoPath, timeoutSeconds);

    if (!aiderResult.ok) {
      throw new RuntimeError(formatCommandFailure("aider command failed", command, aiderResult));
    }

    const diffCommand = this.config.diffCommand ?? ["git", "diff", "--", "src"];
    validateCommand(diffCommand, "diff command");
    rejectDestructiveGitCommand(diffCommand, "diff command");

    const diffResult = await this.shell.run(diffCommand, input.state.repoPath, timeoutSeconds);
    if (!diffResult.ok) {
      throw new RuntimeError(formatCommandFailure("aider diff command failed", diffCommand, diffResult));
    }

    if (!diffResult.stdout.trim()) {
      throw new RuntimeError("empty git diff");
    }

    await artifacts.writeText("CandidatePatch", diffResult.stdout);

    return {
      createdArtifacts: input.declaredOutputs,
      message: aiderResult.stdout
    };
  }

  private buildAiderCommand(promptPath: string): string[] {
    const command = this.config.command ?? "aider";
    if (!command.trim()) {
      throw new RuntimeError("aider command must not be empty");
    }

    const result = [
      command,
      ...(this.config.model ? ["--model", this.config.model] : []),
      ...(this.config.extraArgs ?? []),
      "--message-file",
      promptPath
    ];
    validateCommand(result, "aider command");
    rejectDestructiveGitCommand(result, "aider command");
    return result;
  }
}

function buildAiderPrompt(input: WorkerInput): string {
  const sections = [
    "# NLAH Stage Prompt",
    "",
    "## Stage",
    "",
    input.stageName,
    "",
    "## Task",
    "",
    input.context.taskText
  ];

  if (input.context.roleText) {
    sections.push("", "## Role Policy", "", input.context.roleText);
  }

  sections.push("", "## Input Artifacts");
  for (const [name, content] of Object.entries(input.context.inputArtifacts)) {
    sections.push("", `### ${name}`, "", content);
  }

  sections.push(
    "",
    "## Declared Outputs",
    "",
    ...input.declaredOutputs.map((output) => `- ${output}`),
    "",
    "## Instructions",
    "",
    "Produce the smallest correct repository change for this stage.",
    "Do not commit.",
    "Do not push.",
    "Do not perform destructive git operations."
  );

  return `${sections.join("\n")}\n`;
}

function normalizeAiderPromptText(value: string): string {
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
