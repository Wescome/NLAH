import { readFile } from "node:fs/promises";
import type { ArtifactManager } from "./artifacts.js";
import { ContextError } from "./errors.js";

export type FileReader = (path: string) => Promise<string>;

export type StageContext = {
  taskText: string;
  roleText?: string;
  rolePolicy?: {
    reads?: string[];
    writes?: string[];
    must_not?: string[];
  };
  inputArtifacts: Record<string, string>;
  outputArtifactPaths: Record<string, string>;
};

export function roleNameToFileName(roleName: string): string {
  return `${roleName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()}.md`;
}

async function readOptionalText(
  filePath: string | undefined,
  reader: FileReader
): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  try {
    return await reader(filePath);
  } catch {
    return undefined;
  }
}

export async function buildStageContext(args: {
  taskPath: string;
  rolePath?: string;
  declaredInputs: string[];
  declaredOutputs: string[];
  rolePolicy?: StageContext["rolePolicy"];
  artifacts: ArtifactManager;
  fileReader?: FileReader;
}): Promise<StageContext> {
  const reader: FileReader = args.fileReader ?? ((path) => readFile(path, "utf8"));
  const taskText = await reader(args.taskPath);
  const roleText = await readOptionalText(args.rolePath, reader);
  const inputArtifacts: Record<string, string> = {};
  const outputArtifactPaths: Record<string, string> = {};

  for (const artifactName of args.declaredInputs) {
    const status = await args.artifacts.status(artifactName);
    if (!status.exists || (status.sizeBytes ?? 0) === 0) {
      throw new ContextError(`missing or empty input artifact: ${artifactName}`);
    }
    inputArtifacts[artifactName] = await args.artifacts.readText(artifactName);
  }

  for (const artifactName of args.declaredOutputs) {
    outputArtifactPaths[artifactName] = args.artifacts.resolve(artifactName);
  }

  return {
    taskText,
    inputArtifacts,
    outputArtifactPaths,
    ...(args.rolePolicy === undefined ? {} : { rolePolicy: args.rolePolicy }),
    ...(roleText === undefined ? {} : { roleText })
  };
}
