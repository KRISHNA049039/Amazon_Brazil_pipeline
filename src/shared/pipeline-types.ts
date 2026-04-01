// ─── Pipeline_Engine Models ───

export type ActionType = "build" | "test" | "deploy" | "custom" | "approval";

export interface StageArtifact {
  name: string;
  packageName?: string;
  version?: string;
}

export interface StepDefinition {
  name: string;
  action: ActionType;
  script?: string;
  parallel?: boolean;
  approvalMessage?: string; // message shown to approver for approval steps
}

export interface StageDefinition {
  name: string;
  steps: StepDefinition[];
  inputArtifacts?: StageArtifact[];
  outputArtifacts?: StageArtifact[];
}

export interface PipelineDefinition {
  id: string;
  name: string;
  stages: StageDefinition[];
  trigger?: TriggerConfig;
}

export interface TriggerConfig {
  repository: string;
  branch: string;
  allowParallelRuns: boolean;
}

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";
export type RunStatus = "pending" | "running" | "succeeded" | "failed";

export interface PipelineRun {
  id: string;
  definitionId: string;
  commitRef: string;
  status: RunStatus;
  stages: StageRun[];
  startedAt: Date;
  completedAt?: Date;
}

export interface StageRun {
  stageName: string;
  status: StageStatus;
  steps: StepRun[];
  startedAt?: Date;
  completedAt?: Date;
  inputArtifacts?: StageArtifact[];
  outputArtifacts?: StageArtifact[];
}

export interface StepRun {
  stepName: string;
  action: ActionType;
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  approvalMessage?: string;
  approvedBy?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
}

export interface LogEntry {
  timestamp: Date;
  level: "info" | "warn" | "error";
  message: string;
  stageIndex?: number;
  stepIndex?: number;
}

export interface PipelineRunLog {
  runId: string;
  definitionId: string;
  entries: LogEntry[];
  summary: {
    status: RunStatus;
    startedAt: Date;
    completedAt?: Date;
    stageDurations: Map<string, number>;
    stepDurations: Map<string, number>;
  };
}
