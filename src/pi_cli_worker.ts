import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdapterEnv, AdapterResult } from "./adapters.js";
import { NodeSpawnAdapter } from "./adapters.js";
import type { ArtifactManager } from "./artifacts.js";
import { RuntimeError } from "./errors.js";
import type { WorkerAdapter, WorkerInput, WorkerOutput } from "./workers.js";

export type PiCliWorkerMode = "text" | "json";

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
    private readonly shell: ShellRunner = new NodeSpawnAdapter()
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
      const debugDir = await writePiDebugArtifacts(input, piCommand, piResult);
      throw new RuntimeError(`${formatCommandFailure("pi command failed", piCommand, piResult)}\ndebug: ${debugDir}`);
    }

    const diffCommand = this.config.diffCommand ?? ["git", "diff", "--", "src"];
    validateCommand(diffCommand, "diff command");
    rejectDestructiveGitCommand(diffCommand, "diff command");

    const diffResult = await this.shell.run(diffCommand, input.state.repoPath, timeoutSeconds);
    if (!diffResult.ok) {
      const debugDir = await writePiDebugArtifacts(input, piCommand, piResult, diffCommand, diffResult);
      throw new RuntimeError(`${formatCommandFailure("pi diff command failed", diffCommand, diffResult)}\ndebug: ${debugDir}`);
    }

    if (!diffResult.stdout.trim()) {
      const debugDir = await writePiDebugArtifacts(input, piCommand, piResult, diffCommand, diffResult);
      const upstreamError = extractPiErrorMessage(piResult.stdout);
      throw new RuntimeError(
        [`empty git diff`, upstreamError ? `pi error: ${upstreamError}` : "", `debug: ${debugDir}`]
          .filter(Boolean)
          .join("\n")
      );
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

async function writePiDebugArtifacts(
  input: WorkerInput,
  piCommand: string[],
  piResult: AdapterResult,
  diffCommand?: string[],
  diffResult?: AdapterResult
): Promise<string> {
  const debugDir = path.join(input.state.runRoot, "debug");
  await mkdir(debugDir, { recursive: true });

  await writeFile(
    path.join(debugDir, "pi.command.json"),
    `${JSON.stringify(
      {
        command: redactCommandForDiagnostics(piCommand),
        cwd: input.state.repoPath,
        stageName: input.stageName,
        runId: input.state.runId
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(path.join(debugDir, "pi.stdout"), piResult.stdout, "utf8");
  await writeFile(path.join(debugDir, "pi.stderr"), piResult.stderr, "utf8");
  await writeFile(path.join(debugDir, "pi.result.json"), `${JSON.stringify(piResult, null, 2)}\n`, "utf8");

  if (diffCommand && diffResult) {
    await writeFile(
      path.join(debugDir, "pi.diff_command.json"),
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
    await writeFile(path.join(debugDir, "pi.diff_stdout"), diffResult.stdout, "utf8");
    await writeFile(path.join(debugDir, "pi.diff_stderr"), diffResult.stderr, "utf8");
    await writeFile(path.join(debugDir, "pi.diff_result.json"), `${JSON.stringify(diffResult, null, 2)}\n`, "utf8");
  }

  return debugDir;
}

function extractPiErrorMessage(stdout: string): string | undefined {
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
