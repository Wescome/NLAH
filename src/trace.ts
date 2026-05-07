import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type TraceEvent = {
  timestamp: string;
  runId: string;
  event: string;
  stage?: string;
  fromState?: string;
  toState?: string;
  artifact?: string;
  gate?: string;
  passed?: boolean;
  message?: string;
};

export class TraceLogger {
  constructor(
    private readonly ledgerPath: string,
    private readonly runId: string
  ) {}

  async emit(event: string, payload: Partial<TraceEvent> = {}): Promise<void> {
    const entry: TraceEvent = {
      timestamp: new Date().toISOString(),
      runId: this.runId,
      event,
      ...payload
    };
    await mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
