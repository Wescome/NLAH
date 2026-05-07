import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { HarnessSpec } from "./schema";
import { NlahError, invariant } from "./errors";

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
    invariant(artifact, `unknown artifact: ${name}`);
    const resolved = path.resolve(this.runRoot, artifact.path);
    const runRoot = path.resolve(this.runRoot);
    if (resolved !== runRoot && !resolved.startsWith(`${runRoot}${path.sep}`)) {
      throw new NlahError(`artifact escapes run root: ${name}`);
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
}
