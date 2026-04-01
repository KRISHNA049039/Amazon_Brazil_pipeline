// ─── Deployment_System Models ───

export interface DeploymentTarget {
  id: string;
  name: string;
  environment: string;
  reachable: boolean;
}

export interface DeploymentPlanSpec {
  artifacts: ArtifactRef[];
  targets: TargetDeployment[];
}

export interface ArtifactRef {
  packageName: string;
  version: string;
}

export interface TargetDeployment {
  targetId: string;
  artifactRefs: ArtifactRef[];
  order: number;
}

export interface DeploymentPlan {
  id: string;
  targets: TargetDeployment[];
  createdAt: Date;
}

export type DeploymentTargetStatus = "pending" | "in-progress" | "succeeded" | "failed";

export interface DeploymentStatus {
  deploymentId: string;
  targetStatuses: Map<string, DeploymentTargetStatus>;
}

export interface DeploymentRecord {
  id: string;
  targetId: string;
  artifactVersion: string;
  packageName: string;
  deployedAt: Date;
  deployedBy: string;
  outcome: "succeeded" | "failed" | "rolled-back";
}

export interface DeploymentResult {
  deploymentId: string;
  records: DeploymentRecord[];
}
