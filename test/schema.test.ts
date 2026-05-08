import { describe, expect, it } from "vitest";
import { HarnessSpecSchema, StageSpecSchema } from "../src/schema.js";
import { validSpec } from "./helpers.js";

describe("schema validation", () => {
  it("valid harness parses", () => {
    expect(HarnessSpecSchema.parse(validSpec()).nlahspec).toBe("0.1");
  });

  it("invalid version fails", () => {
    expect(HarnessSpecSchema.safeParse({ ...validSpec(), nlahspec: "0.2" }).success).toBe(false);
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
});
