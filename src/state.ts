import type { ArtifactStatus } from "./artifacts.js";
import type { TraceEvent } from "./trace.js";

export type RuntimeStatus = "PASS" | "FAIL" | "INCOMPLETE";

export type RuntimeState = {
  runId: string;
  currentState: string;
  taskPath: string;
  repoPath: string;
  harnessPath: string;
  runRoot: string;
  stateRoot: string;
  artifactRoot: string;
  stageHistory: TraceEvent[];
  artifacts: Record<string, ArtifactStatus>;
  lastError?: string;
};

export type RuntimeResult = {
  runId: string;
  status: RuntimeStatus;
  finalState: string;
  runRoot: string;
  artifactRoot: string;
  tracePath: string;
  message?: string;
};
