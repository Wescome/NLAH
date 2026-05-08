import { RuntimeError } from "./errors.js";
import type { WorkerAdapter } from "./workers.js";
import { DeterministicWorkerAdapter } from "./workers.js";

export type WorkerRegistryConfig = {
  defaultWorker?: string;
  workers?: Record<string, WorkerAdapter>;
};

export class WorkerRegistry {
  private readonly defaultWorker: string;
  private readonly workers: Map<string, WorkerAdapter>;

  constructor(config: WorkerRegistryConfig = {}) {
    this.defaultWorker = config.defaultWorker ?? "deterministic";
    this.workers = new Map<string, WorkerAdapter>();

    this.workers.set("deterministic", new DeterministicWorkerAdapter());

    for (const [name, worker] of Object.entries(config.workers ?? {})) {
      this.register(name, worker);
    }
  }

  register(name: string, worker: WorkerAdapter): void {
    if (!name.trim()) {
      throw new RuntimeError("worker name must not be empty");
    }

    this.workers.set(name, worker);
  }

  get(name: string): WorkerAdapter {
    const worker = this.workers.get(name);

    if (!worker) {
      throw new RuntimeError(`unknown worker: ${name}`);
    }

    return worker;
  }

  getDefault(): WorkerAdapter {
    return this.get(this.defaultWorker);
  }

  has(name: string): boolean {
    return this.workers.has(name);
  }

  names(): string[] {
    return [...this.workers.keys()].sort();
  }
}
