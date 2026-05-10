import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterEnv, AdapterResult } from "./adapters.js";
import { NodeSpawnAdapter } from "./adapters.js";
import type { ArtifactManager } from "./artifacts.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type LoomDomainConfig = {
  domain: string;
  promptTemplate?: string;
  contextGlobs?: string[];
  outputArtifactType?: string;
  diffStrategy?: "git" | "document" | "structured";
  constraints?: string[];
};

export type LoomCliWorkerConfig = {
  command?: string;
  mode?: "text" | "json";
  extraArgs?: string[];
  timeoutSeconds?: number;
  diffCommand?: string[];
  env?: AdapterEnv;
  domainConfig?: LoomDomainConfig;
};

type ShellRunner = {
  run(command: string[], cwd: string, timeoutSeconds?: number, env?: AdapterEnv): Promise<AdapterResult>;
};

export class LoomCliWorkerAdapter implements WorkerAdapter {
  constructor(
    private readonly config: LoomCliWorkerConfig = {},
    private readonly shell: ShellRunner = new NodeSpawnAdapter()
  ) {}

  async execute(input: WorkerInput, artifacts: ArtifactManager): Promise<WorkerOutput> {
    const outputArtifact = this.resolveOutputArtifact(input);

    if (input.declaredOutputs.length !== 1 || input.declaredOutputs[0] !== outputArtifact) {
      throw new RuntimeError("LoomCliWorkerAdapter only supports single-artifact output");
    }

    const promptPath = path.join(input.state.runRoot, "worker_prompts", `${input.stageName}.loom.md`);
    const prompt = normalizeLoomPromptText(buildLoomPrompt(input, this.config.domainConfig));
    await mkdir(path.dirname(promptPath), { recursive: true });
    await writeFile(promptPath, prompt, "utf8");

    const timeoutSeconds = this.config.timeoutSeconds ?? 300;
    const piCommand = this.buildPiCommand(promptPath);
    const piResult = await this.shell.run(piCommand, input.state.repoPath, timeoutSeconds, this.config.env);

    if (!piResult.ok) {
      const debugDir = await writeLoomDebugArtifacts(input, piCommand, piResult);
      throw new RuntimeError(`${formatCommandFailure("loom pi command failed", piCommand, piResult)}\ndebug: ${debugDir}`);
    }

    const diffCommand = this.config.diffCommand ?? ["git", "diff", "--relative", "--", "src"];
    validateCommand(diffCommand, "diff command");
    rejectDestructiveGitCommand(diffCommand, "diff command");

    const diffResult = await this.shell.run(diffCommand, input.state.repoPath, timeoutSeconds);
    if (!diffResult.ok) {
      const debugDir = await writeLoomDebugArtifacts(input, piCommand, piResult, diffCommand, diffResult);
      throw new RuntimeError(
        `${formatCommandFailure("loom diff command failed", diffCommand, diffResult)}\ndebug: ${debugDir}`
      );
    }

    if (!diffResult.stdout.trim()) {
      const debugDir = await writeLoomDebugArtifacts(input, piCommand, piResult, diffCommand, diffResult);
      const upstreamError = extractLoomErrorMessage(piResult.stdout);
      throw new RuntimeError(
        [`empty git diff`, upstreamError ? `loom error: ${upstreamError}` : "", `debug: ${debugDir}`]
          .filter(Boolean)
          .join("\n")
      );
    }

    await artifacts.writeText(outputArtifact, diffResult.stdout);

    return {
      createdArtifacts: [outputArtifact],
      message: piResult.stdout
    };
  }

  private resolveOutputArtifact(input: WorkerInput): string {
    return this.config.domainConfig?.outputArtifactType ?? input.declaredOutputs[0] ?? "CandidatePatch";
  }

  private buildPiCommand(promptPath: string): string[] {
    const command = this.config.command ?? "pi";
    if (!command.trim()) {
      throw new RuntimeError("pi command must not be empty");
    }

    const mode = this.config.mode ?? "text";
    const promptFileArg = `@${promptPath}`;
    const result =
      mode === "json"
        ? [command, "-p", "--mode", "json", promptFileArg, ...(this.config.extraArgs ?? [])]
        : [command, "-p", promptFileArg, ...(this.config.extraArgs ?? [])];

    validateCommand(result, "pi command");
    rejectDestructiveGitCommand(result, "pi command");
    return result;
  }
}

async function writeLoomDebugArtifacts(
  input: WorkerInput,
  loomCommand: string[],
  loomResult: AdapterResult,
  diffCommand?: string[],
  diffResult?: AdapterResult
): Promise<string> {
  const debugDir = path.join(input.state.runRoot, "debug");
  await mkdir(debugDir, { recursive: true });

  await writeFile(
    path.join(debugDir, "loom.command.json"),
    `${JSON.stringify(
      {
        command: redactCommandForDiagnostics(loomCommand),
        cwd: input.state.repoPath,
        stageName: input.stageName,
        runId: input.state.runId
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(debugDir, "loom.stdout"), loomResult.stdout, "utf8");
  await writeFile(path.join(debugDir, "loom.stderr"), loomResult.stderr, "utf8");
  await writeFile(path.join(debugDir, "loom.result.json"), `${JSON.stringify(loomResult, null, 2)}\n`, "utf8");

  if (diffCommand && diffResult) {
    await writeFile(
      path.join(debugDir, "loom.diff_command.json"),
      `${JSON.stringify(
        {
          command: diffCommand,
          cwd: input.state.repoPath,
          stageName: input.stageName,
          runId: input.state.runId
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(path.join(debugDir, "loom.diff_stdout"), diffResult.stdout, "utf8");
    await writeFile(path.join(debugDir, "loom.diff_stderr"), diffResult.stderr, "utf8");
    await writeFile(path.join(debugDir, "loom.diff_result.json"), `${JSON.stringify(diffResult, null, 2)}\n`, "utf8");
  }

  return debugDir;
}

function extractLoomErrorMessage(stdout: string): string | undefined {
  for (const line of stdout.trim().split("\n").reverse()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line) as {
        message?: {
          errorMessage?: unknown;
        };
        finalError?: unknown;
      };
      if (typeof event.finalError === "string" && event.finalError.trim()) {
        return event.finalError;
      }
      if (typeof event.message?.errorMessage === "string" && event.message.errorMessage.trim()) {
        return event.message.errorMessage;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function buildLoomPrompt(input: WorkerInput, domainConfig?: LoomDomainConfig): string {
  const sections = [
    "# NLAH Loom Stage Prompt",
    "",
    "## Stage",
    input.stageName,
    "",
    "## Role",
    input.roleName
  ];

  if (domainConfig) {
    sections.push("", "## Domain", domainConfig.domain);

    if (domainConfig.promptTemplate) {
      sections.push("", "## Domain Instructions", domainConfig.promptTemplate);
    }

    if (domainConfig.contextGlobs && domainConfig.contextGlobs.length > 0) {
      sections.push("", "## Context Scope", ...domainConfig.contextGlobs.map((g) => `- ${g}`));
    }

    if (domainConfig.diffStrategy) {
      sections.push("", "## Diff Strategy", domainConfig.diffStrategy);
    }

    if (domainConfig.constraints && domainConfig.constraints.length > 0) {
      sections.push("", "## Domain Constraints", ...domainConfig.constraints.map((c) => `- ${c}`));
    }
  }

  sections.push("", "## Task", input.context.taskText);

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

function normalizeLoomPromptText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
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
    `command: ${redactCommandForDiagnostics(command).join(" ")}`,
    `exit: ${result.returncode}`,
    result.timedOut ? "timed out: true" : "",
    result.signal ? `signal: ${result.signal}` : "",
    result.failed ? "failed: true" : "",
    result.stderr ? `stderr: ${result.stderr}` : "",
    result.stdout ? `stdout: ${result.stdout}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function redactCommandForDiagnostics(command: string[]): string[] {
  return command.map((part, index) => (command[index - 1] === "--api-key" ? "[redacted]" : part));
}
