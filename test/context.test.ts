import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { FsArtifactManager } from "../src/artifacts.js";
import { buildStageContext, roleNameToFileName } from "../src/context.js";
import { ContextError } from "../src/errors.js";
import { tempDir, validSpec } from "./helpers.js";

describe("stage context", () => {
  it("loads task text and role text", async () => {
    const root = await tempDir("nlah-context-");
    const taskPath = path.join(root, "TASK.md");
    const rolePath = path.join(root, "role.md");
    await writeFile(taskPath, "Task body", "utf8");
    await writeFile(rolePath, "Role policy", "utf8");

    const context = await buildStageContext({
      taskPath,
      rolePath,
      declaredInputs: [],
      declaredOutputs: ["RepoMap"],
      artifacts: new FsArtifactManager(root, validSpec())
    });

    expect(context.taskText).toBe("Task body");
    expect(context.roleText).toBe("Role policy");
  });

  it("omits role text when role file is missing", async () => {
    const root = await tempDir("nlah-context-");
    const taskPath = path.join(root, "TASK.md");
    await writeFile(taskPath, "Task body", "utf8");

    const context = await buildStageContext({
      taskPath,
      rolePath: path.join(root, "missing.md"),
      declaredInputs: [],
      declaredOutputs: ["RepoMap"],
      artifacts: new FsArtifactManager(root, validSpec())
    });

    expect(context).not.toHaveProperty("roleText");
  });

  it("loads input artifact text and output artifact paths", async () => {
    const root = await tempDir("nlah-context-");
    const taskPath = path.join(root, "TASK.md");
    const artifacts = new FsArtifactManager(root, validSpec());
    await writeFile(taskPath, "Task body", "utf8");
    await artifacts.writeText("IssueContract", "Issue contract text");

    const context = await buildStageContext({
      taskPath,
      declaredInputs: ["IssueContract"],
      declaredOutputs: ["RepoMap"],
      artifacts
    });

    expect(context.inputArtifacts.IssueContract).toBe("Issue contract text");
    expect(context.outputArtifactPaths.RepoMap).toBe(path.join(root, "artifacts", "repo_map.md"));
  });

  it("throws ContextError for missing input artifact", async () => {
    const root = await tempDir("nlah-context-");
    const taskPath = path.join(root, "TASK.md");
    await writeFile(taskPath, "Task body", "utf8");

    await expect(
      buildStageContext({
        taskPath,
        declaredInputs: ["IssueContract"],
        declaredOutputs: ["RepoMap"],
        artifacts: new FsArtifactManager(root, validSpec())
      })
    ).rejects.toThrow(ContextError);
  });

  it("maps role names to policy filenames", () => {
    expect(roleNameToFileName("Cartographer")).toBe("cartographer.md");
    expect(roleNameToFileName("PatchWorker")).toBe("patch_worker.md");
    expect(roleNameToFileName("ReleaseAgent")).toBe("release_agent.md");
    expect(roleNameToFileName("Test Engineer")).toBe("test_engineer.md");
  });
});
