import { describe, expect, it } from "vitest";
import path from "node:path";
import YAML from "yaml";
import { formatValidationReportJson, formatValidationReportText } from "../src/cli.js";
import type { ValidationReport } from "../src/validator.js";
import { validateHarnessFile } from "../src/validator.js";
import { tempDir, validSpec, writeHarness } from "./helpers.js";

describe("validator", () => {
  it("valid crew harness returns VALID", async () => {
    const report = await validateHarnessFile(path.resolve("harnesses/crew.mvp.yaml"));

    expect(report.status).toBe("VALID");
    expect(report.errors).toEqual([]);
    expect(report.stageOrder).toEqual(["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"]);
    expect(report.startState).toBe("TaskReceived");
    expect(report.terminalStates).toEqual(["PullRequestReady"]);
  });

  it("invalid harness returns INVALID instead of throwing", async () => {
    const root = await tempDir("nlah-validator-");
    const spec = validSpec();
    spec.stages.CONTRACT!.inputs = ["IssueContract"];
    const harnessPath = await writeHarness(root, YAML.stringify(spec));

    const report = await validateHarnessFile(harnessPath);

    expect(report.status).toBe("INVALID");
  });

  it("invalid report includes error message", async () => {
    const root = await tempDir("nlah-validator-error-");
    const spec = validSpec();
    spec.stages.MAP!.outputs = ["MissingArtifact"];
    const harnessPath = await writeHarness(root, YAML.stringify(spec));

    const report = await validateHarnessFile(harnessPath);

    expect(report.status).toBe("INVALID");
    expect(report.errors[0]).toContain("missing artifact output");
  });
});

describe("validation report formatters", () => {
  const report: ValidationReport = {
    status: "VALID",
    harnessPath: "/tmp/crew.mvp.yaml",
    errors: [],
    warnings: [],
    stageOrder: ["CONTRACT", "MAP", "PATCH", "VERIFY", "RELEASE"],
    startState: "TaskReceived",
    terminalStates: ["PullRequestReady"]
  };

  it("text formatter includes Status: VALID", () => {
    expect(formatValidationReportText(report)).toContain("Status: VALID");
  });

  it("text formatter includes stage order", () => {
    expect(formatValidationReportText(report)).toContain(
      "Stage Order: CONTRACT -> MAP -> PATCH -> VERIFY -> RELEASE"
    );
  });

  it("json formatter parses", () => {
    const parsed = JSON.parse(formatValidationReportJson(report)) as ValidationReport;

    expect(parsed.status).toBe("VALID");
    expect(parsed.stageOrder).toEqual(report.stageOrder);
  });
});
