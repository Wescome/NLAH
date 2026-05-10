import { describe, expect, it } from "vitest";
import { HarnessSpecSchema, StageSpecSchema } from "../src/schema.js";
import { validSpec } from "./helpers.js";

describe("schema validation", () => {
  it("valid harness parses", () => {
    expect(HarnessSpecSchema.parse(validSpec()).nlahspec).toBe("0.1");
  });

  it("v0.2 version parses", () => {
    expect(HarnessSpecSchema.parse({ ...validSpec(), nlahspec: "0.2" }).nlahspec).toBe("0.2");
  });

  it("v0.2 runtime_policy and gates fields normalize", () => {
    const spec = validSpec();
    const parsed = HarnessSpecSchema.parse({
      ...spec,
      nlahspec: "0.2",
      runtime: undefined,
      runtime_policy: {
        ...spec.runtime,
        max_retries_per_stage: 2
      },
      stages: {
        ...spec.stages,
        CONTRACT: {
          ...spec.stages.CONTRACT!,
          gate: undefined,
          gates: { all: [{ exists: "IssueContract" }] }
        }
      }
    });

    expect(parsed.runtime.max_repair_rounds).toBe(2);
    expect(parsed.stages.CONTRACT?.gate?.all).toEqual([{ exists: "IssueContract" }]);
  });

  it("missing harness metadata fails", () => {
    const spec = validSpec();
    expect(HarnessSpecSchema.safeParse({ ...spec, harness: { ...spec.harness, name: "" } }).success).toBe(false);
  });

  it("missing role responsibility fails", () => {
    const spec = validSpec();
    expect(HarnessSpecSchema.safeParse({ ...spec, roles: { Bad: { responsibility: "" } } }).success).toBe(false);
  });

  it("stage defaults inputs and outputs", () => {
    const stage = StageSpecSchema.parse({
      from: "A",
      to: "B",
      role: "Cartographer"
    });
    expect(stage.inputs).toEqual([]);
    expect(stage.outputs).toEqual([]);
  });

  it("stage parses without worker", () => {
    const stage = StageSpecSchema.parse({
      from: "A",
      to: "B",
      role: "Cartographer"
    });
    expect(stage.worker).toBeUndefined();
  });

  it("stage parses with worker", () => {
    const stage = StageSpecSchema.parse({
      from: "A",
      to: "B",
      role: "Cartographer",
      worker: "fake"
    });
    expect(stage.worker).toBe("fake");
  });
});
