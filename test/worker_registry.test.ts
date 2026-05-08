import { describe, expect, it } from "vitest";
import type { ArtifactManager } from "../src/artifacts.js";
import { RuntimeError } from "../src/errors.js";
import { WorkerRegistry } from "../src/worker_registry.js";
import { DeterministicWorkerAdapter, type WorkerAdapter, type WorkerInput, type WorkerOutput } from "../src/workers.js";

class FakeWorker implements WorkerAdapter {
  async execute(_input: WorkerInput, _artifacts: ArtifactManager): Promise<WorkerOutput> {
    return { createdArtifacts: [] };
  }
}

describe("WorkerRegistry", () => {
  it("includes deterministic worker by default", () => {
    const registry = new WorkerRegistry();
    expect(registry.has("deterministic")).toBe(true);
  });

  it("getDefault returns deterministic worker by default", () => {
    const registry = new WorkerRegistry();
    expect(registry.getDefault()).toBeInstanceOf(DeterministicWorkerAdapter);
  });

  it("can register custom worker", () => {
    const registry = new WorkerRegistry();
    const worker = new FakeWorker();
    registry.register("fake", worker);
    expect(registry.get("fake")).toBe(worker);
  });

  it("can construct with custom workers", () => {
    const worker = new FakeWorker();
    const registry = new WorkerRegistry({ workers: { fake: worker } });
    expect(registry.get("fake")).toBe(worker);
  });

  it("can override defaultWorker", () => {
    const worker = new FakeWorker();
    const registry = new WorkerRegistry({
      defaultWorker: "fake",
      workers: { fake: worker }
    });
    expect(registry.getDefault()).toBe(worker);
  });

  it("unknown worker throws RuntimeError", () => {
    const registry = new WorkerRegistry();
    expect(() => registry.get("missing")).toThrow(RuntimeError);
  });

  it("empty worker name throws RuntimeError", () => {
    const registry = new WorkerRegistry();
    expect(() => registry.register("   ", new FakeWorker())).toThrow(RuntimeError);
  });

  it("names returns sorted names", () => {
    const registry = new WorkerRegistry({
      workers: {
        zebra: new FakeWorker(),
        alpha: new FakeWorker()
      }
    });
    expect(registry.names()).toEqual(["alpha", "deterministic", "zebra"]);
  });
});
