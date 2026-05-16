import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessSpec } from "./schema.js";
import { ArtifactError } from "./errors.js";

export type ArtifactStatus = {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes?: number;
};

export type ArtifactContractResult = {
  passed: boolean;
  message: string;
};

export type ArtifactStorageHandle =
  | { kind: "fs"; root: string }
  | { kind: "r2"; bucketBinding: string; prefix: string };

export interface ArtifactManager {
  resolve(name: string): string;
  exists(name: string): Promise<boolean>;
  readText(name: string): Promise<string>;
  writeText(name: string, content: string): Promise<string>;
  status(name: string): Promise<ArtifactStatus>;
  validateContract(name: string): Promise<ArtifactContractResult>;
  allStatuses(): Promise<Record<string, ArtifactStatus>>;
  getStorageHandle(): ArtifactStorageHandle;
}

export class FsArtifactManager implements ArtifactManager {
  constructor(
    private readonly runRoot: string,
    private readonly spec: HarnessSpec
  ) {}

  getStorageHandle(): ArtifactStorageHandle {
    return { kind: "fs", root: this.runRoot };
  }

  resolve(name: string): string {
    const artifact = this.spec.artifacts[name];
    if (!artifact) {
      throw new ArtifactError(`unknown artifact: ${name}`);
    }
    if (path.isAbsolute(artifact.path)) {
      throw new ArtifactError(`artifact path must be relative: ${name}`);
    }

    const resolved = path.resolve(this.runRoot, artifact.path);
    const root = path.resolve(this.runRoot);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new ArtifactError(`artifact path escapes run root: ${name}`);
    }
    return resolved;
  }

  async exists(name: string): Promise<boolean> {
    try {
      const info = await stat(this.resolve(name));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  async readText(name: string): Promise<string> {
    return readFile(this.resolve(name), "utf8");
  }

  async writeText(name: string, content: string): Promise<string> {
    const target = this.resolve(name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return target;
  }

  async status(name: string): Promise<ArtifactStatus> {
    const target = this.resolve(name);
    try {
      const info = await stat(target);
      return {
        name,
        path: target,
        exists: info.isFile(),
        sizeBytes: info.size
      };
    } catch {
      return {
        name,
        path: target,
        exists: false
      };
    }
  }

  async validateContract(name: string): Promise<ArtifactContractResult> {
    const artifact = this.spec.artifacts[name];
    if (!artifact) {
      throw new ArtifactError(`unknown artifact: ${name}`);
    }

    const status = await this.status(name);
    if (artifact.required && (!status.exists || (status.sizeBytes ?? 0) === 0)) {
      return { passed: false, message: `${name} missing or empty` };
    }
    if (!artifact.contract) {
      return { passed: true, message: `${name} has no artifact contract` };
    }

    const content = await this.readText(name);
    const contract = artifact.contract;

    if (contract.kind === "markdown") {
      for (const section of contract.required_sections ?? []) {
        const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|\\n)#+\\s*${escaped}\\b`, "i");
        if (!pattern.test(content)) {
          return { passed: false, message: `${name} missing markdown section: ${section}` };
        }
      }
      for (const requiredPattern of contract.required_patterns ?? []) {
        if (!new RegExp(requiredPattern, "m").test(content)) {
          return { passed: false, message: `${name} missing required pattern: ${requiredPattern}` };
        }
      }
      return { passed: true, message: `${name} satisfies markdown contract` };
    }

    if (contract.kind === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { passed: false, message: `${name} contains invalid JSON` };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { passed: false, message: `${name} JSON artifact must be an object` };
      }
      for (const field of contract.required_fields ?? []) {
        if (!(field in parsed)) {
          return { passed: false, message: `${name} missing JSON field: ${field}` };
        }
      }
      return { passed: true, message: `${name} satisfies JSON contract` };
    }

    if (contract.non_empty && content.trim().length === 0) {
      return { passed: false, message: `${name} must be non-empty` };
    }
    for (const requiredPattern of contract.required_patterns ?? []) {
      if (!new RegExp(requiredPattern, "m").test(content)) {
        return { passed: false, message: `${name} missing required pattern: ${requiredPattern}` };
      }
    }
    return { passed: true, message: `${name} satisfies text contract` };
  }

  async allStatuses(): Promise<Record<string, ArtifactStatus>> {
    const statuses: Record<string, ArtifactStatus> = {};
    for (const name of Object.keys(this.spec.artifacts)) {
      statuses[name] = await this.status(name);
    }
    return statuses;
  }
}
