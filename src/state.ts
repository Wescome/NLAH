import type { ArtifactStatus } from "./artifacts";
import type { TraceEvent } from "./trace";

export type RuntimeState = {
  runId: string;
  currentState: string;
  taskPath: string;
  repoPath: string;
  harnessPath: string;
  stateRoot: string;
  artifactRoot: string;
  stageHistory: TraceEvent[];
  artifacts: Record<string, ArtifactStatus>;
  lastError?: string;
};
