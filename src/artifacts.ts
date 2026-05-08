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

export class ArtifactManager {
  constructor(
    private readonly runRoot: string,
    private readonly spec: HarnessSpec
  ) {}

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

  async allStatuses(): Promise<Record<string, ArtifactStatus>> {
    const statuses: Record<string, ArtifactStatus> = {};
    for (const name of Object.keys(this.spec.artifacts)) {
      statuses[name] = await this.status(name);
    }
    return statuses;
  }
}
