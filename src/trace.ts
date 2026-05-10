import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type TraceEvent = {
  timestamp: string;
  runId: string;
  event: string;
  stage?: string;
  role?: string;
  worker?: string;
  fromState?: string;
  toState?: string;
  artifact?: string;
  path?: string;
  gate?: string;
  gateId?: string;
  uses?: string;
  reads?: string[];
  proves?: string;
  failureClass?: string;
  action?: string;
  retryCounters?: Record<string, number>;
  passed?: boolean;
  message?: string;
  inputArtifacts?: string[];
  outputArtifacts?: string[];
  producedArtifacts?: string[];
  producerStage?: string;
  producerRole?: string;
  passedGateIds?: string[];
  memberResults?: unknown;
};

export class TraceLogger {
  constructor(
    private readonly ledgerPath: string,
    private readonly runId: string
  ) {}

  async emit(
    event: string,
    payload: Partial<Omit<TraceEvent, "timestamp" | "runId" | "event">> = {}
  ): Promise<TraceEvent> {
    const entry: TraceEvent = {
      timestamp: new Date().toISOString(),
      runId: this.runId,
      event,
      ...payload
    };
    await mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  get path(): string {
    return this.ledgerPath;
  }
}
