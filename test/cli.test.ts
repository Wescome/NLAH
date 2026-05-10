import { describe, expect, it } from "vitest";
import {
  buildRunHarnessOptions,
  createCliWorkerRegistry,
  formatCrewManifestJson,
  formatCrewManifestText,
  formatRunResultJson,
  formatRunResultText,
  formatValidationReportJson,
  formatValidationReportText
} from "../src/cli.js";
import { RuntimeError } from "../src/errors.js";
import type { CrewManifest } from "../src/manifest.js";
import type { RuntimeResult } from "../src/state.js";
import type { ValidationReport } from "../src/validator.js";
import { WorkerRegistry } from "../src/worker_registry.js";

function resultFixture(overrides: Partial<RuntimeResult> = {}): RuntimeResult {
  return {
    runId: "cli-test",
    status: "PASS",
    finalState: "PullRequestReady",
    runRoot: "/tmp/nlah/runs/cli-test",
    artifactRoot: "/tmp/nlah/runs/cli-test/artifacts",
    tracePath: "/tmp/nlah/runs/cli-test/state/task_history.jsonl",
    summaryPath: "/tmp/nlah/runs/cli-test/summary.json",
    ...overrides
  };
}

describe("cli formatters", () => {
  it("text formatter includes the summary path", () => {
    const output = formatRunResultText(resultFixture());

    expect(output).toContain("Run ID: cli-test");
    expect(output).toContain("Status: PASS");
    expect(output).toContain("State: PullRequestReady");
    expect(output).toContain("Artifacts: /tmp/nlah/runs/cli-test/artifacts");
    expect(output).toContain("Trace: /tmp/nlah/runs/cli-test/state/task_history.jsonl");
    expect(output).toContain("Summary: /tmp/nlah/runs/cli-test/summary.json");
  });

  it("text formatter includes failure messages", () => {
    const output = formatRunResultText(resultFixture({ status: "FAIL", message: "gate failed" }));

    expect(output).toContain("Message: gate failed");
  });

  it("json formatter parses back to the same status, finalState, and summaryPath", () => {
    const result = resultFixture({ status: "INCOMPLETE", finalState: "PatchCandidate" });
    const parsed = JSON.parse(formatRunResultJson(result)) as RuntimeResult;

    expect(parsed.status).toBe(result.status);
    expect(parsed.finalState).toBe(result.finalState);
    expect(parsed.summaryPath).toBe(result.summaryPath);
  });
});

describe("cli worker registry", () => {
  it("returns undefined when no worker is selected", () => {
    expect(createCliWorkerRegistry(undefined)).toBeUndefined();
  });

  it("returns a WorkerRegistry for deterministic", () => {
    const registry = createCliWorkerRegistry("deterministic");

    expect(registry).toBeInstanceOf(WorkerRegistry);
    expect(registry?.getDefault()).toBeTruthy();
  });

  it("throws RuntimeError for unsupported workers", () => {
    expect(() => createCliWorkerRegistry("script")).toThrow(RuntimeError);
    expect(() => createCliWorkerRegistry("script")).toThrow("unsupported CLI worker: script");
  });
});

describe("cli run options", () => {
  it("includes overwriteRun when requested", () => {
    expect(buildRunHarnessOptions({ overwriteRun: true })).toMatchObject({ overwriteRun: true });
  });

  it("returns runId for simple old-style run options", () => {
    expect(buildRunHarnessOptions({ runId: "cli-run" })).toBe("cli-run");
  });

  it("includes runId with composite options", () => {
    expect(buildRunHarnessOptions({ runId: "cli-run", overwriteRun: true })).toMatchObject({
      runId: "cli-run",
      overwriteRun: true
    });
  });

  it("includes workerRegistry for deterministic worker", () => {
    const options = buildRunHarnessOptions({ worker: "deterministic" });

    expect(options).toMatchObject({ workerRegistry: expect.any(WorkerRegistry) });
  });

  it("unsupported worker still throws RuntimeError", () => {
    expect(() => buildRunHarnessOptions({ worker: "script" })).toThrow(RuntimeError);
  });
});

describe("cli validation formatters", () => {
  const report: ValidationReport = {
    status: "VALID",
    harnessPath: "/tmp/crew.mvp.yaml",
    errors: [],
    warnings: [],
    stageOrder: ["CONTRACT", "MAP"],
    startState: "TaskReceived",
    terminalStates: ["RepoMapped"]
  };

  it("text formatter includes validation status and stage order", () => {
    const output = formatValidationReportText(report);

    expect(output).toContain("Status: VALID");
    expect(output).toContain("Stage Order: CONTRACT -> MAP");
  });

  it("json formatter parses back to validation report", () => {
    const parsed = JSON.parse(formatValidationReportJson(report)) as ValidationReport;

    expect(parsed.status).toBe("VALID");
    expect(parsed.stageOrder).toEqual(["CONTRACT", "MAP"]);
  });
});

describe("cli manifest formatters", () => {
  const manifest: CrewManifest = {
    nlahspec: "0.2",
    harnessName: "CREW_MVP",
    taskFamily: "repository_issue_resolution",
    objective: "test objective",
    runtimePolicy: {
      graphMode: "linear",
      maxRetriesPerStage: 0,
      maxTotalRetries: 0,
      defaultFailureAction: "abort",
      resume: false
    },
    stageOrder: ["CONTRACT", "MAP"],
    startState: "TaskReceived",
    terminalStates: ["RepoMapped"],
    warnings: [],
    roles: {
      Cartographer: { responsibility: "map" }
    },
    artifacts: {
      IssueContract: { path: "artifacts/issue_contract.md", required: true }
    },
    failureTaxonomy: {},
    stages: [
      {
        name: "CONTRACT",
        from: "TaskReceived",
        to: "IssueContracted",
        role: "Cartographer",
        inputs: [],
        outputs: ["IssueContract"],
        gates: ["exists: IssueContract"],
        gateContracts: [
          {
            id: "exists-issue-contract",
            uses: "exists",
            reads: ["IssueContract"],
            proves: "issue_contract_exists",
            on_fail: "missing_artifact",
            args: "IssueContract"
          }
        ]
      }
    ]
  };

  it("text formatter includes crew and stage lines", () => {
    const output = formatCrewManifestText(manifest);

    expect(output).toContain("Crew: CREW_MVP");
    expect(output).toContain(
      "- CONTRACT: TaskReceived -> IssueContracted | role=Cartographer | inputs=[] | outputs=[IssueContract]"
    );
  });

  it("json formatter parses back to manifest", () => {
    const parsed = JSON.parse(formatCrewManifestJson(manifest)) as CrewManifest;

    expect(parsed.harnessName).toBe("CREW_MVP");
    expect(parsed.stageOrder).toEqual(["CONTRACT", "MAP"]);
  });
});
