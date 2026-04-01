// ─── Build_System Errors ───

export type RegistrationError =
  | { type: "DuplicateName"; name: string }
  | { type: "InvalidManifest"; missingFields: string[] }
  | { type: "UnresolvedDeps"; unresolvedDependencies: string[] };

export type ResolutionError =
  | { type: "CycleDetected"; cyclePath: string[] }
  | { type: "MissingDependency"; missingDependencies: string[] }
  | { type: "PackageNotFound"; packageId: string };

export type BuildError =
  | { type: "StepFailed"; stepName: string; reason: string }
  | { type: "ResolutionFailed"; error: ResolutionError }
  | { type: "PackageNotFound"; packageId: string };

export type VersionSetError =
  | { type: "MissingVersions"; missing: Array<{ packageName: string; version: string }> }
  | { type: "DuplicateName"; name: string };

export type ArtifactError =
  | { type: "NotFound"; packageName: string; version: string }
  | { type: "AlreadyExists"; packageName: string; version: string };

// ─── Deployment_System Errors ───

export type PlanError =
  | { type: "InvalidArtifacts"; invalidRefs: Array<{ packageName: string; version: string }> }
  | { type: "InvalidTargets"; invalidTargetIds: string[] }
  | { type: "Mixed"; invalidArtifacts: Array<{ packageName: string; version: string }>; invalidTargets: string[] };

export type DeploymentError =
  | { type: "TargetFailed"; targetId: string; reason: string }
  | { type: "PlanNotFound"; planId: string };

export type RollbackError =
  | { type: "NoHistory"; targetId: string }
  | { type: "TargetNotFound"; targetId: string }
  | { type: "DeployFailed"; targetId: string; reason: string };

// ─── Pipeline_Engine Errors ───

export type ParseError =
  | { type: "SyntaxError"; location: string; description: string }
  | { type: "UnknownAction"; actionType: string };

export type PipelineError =
  | { type: "StepFailed"; stageName: string; stepName: string; reason: string }
  | { type: "DefinitionNotFound"; definitionId: string }
  | { type: "ApprovalRejected"; stageName: string; stepName: string; rejectedBy: string }
  | { type: "ApprovalTimeout"; stageName: string; stepName: string }
  | { type: "RunNotFound"; runId: string };

export type TriggerError =
  | { type: "ConcurrentRun"; definitionId: string }
  | { type: "DefinitionNotFound"; definitionId: string };
