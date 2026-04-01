import { Result, ok, err } from "../shared/result.js";
import {
  DeploymentPlan,
  DeploymentResult,
  DeploymentRecord,
  DeploymentStatus,
  DeploymentTargetStatus,
} from "../shared/deployment-types.js";
import { DeploymentError } from "../shared/errors.js";
import { DeploymentHistory } from "./deployment-history.js";
import { ArtifactRepository } from "../build-system/artifact-repository.js";

export interface DeployAgent {
  deploy(targetId: string, packageName: string, version: string): Promise<Result<void, string>>;
}

export class DefaultDeployAgent implements DeployAgent {
  async deploy(_targetId: string, _packageName: string, _version: string): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

let nextDeployId = 1;
let nextRecordId = 1;

export class DeploymentExecutor {
  private statuses = new Map<string, DeploymentStatus>();

  constructor(
    private history: DeploymentHistory,
    private artifactRepo: ArtifactRepository,
    private agent: DeployAgent = new DefaultDeployAgent(),
    private operator: string = "system"
  ) {}

  async execute(plan: DeploymentPlan): Promise<Result<DeploymentResult, DeploymentError>> {
    const deploymentId = `deploy-${nextDeployId++}`;
    const targetStatuses = new Map<string, DeploymentTargetStatus>();
    const records: DeploymentRecord[] = [];

    // Initialize all targets as pending
    for (const td of plan.targets) {
      targetStatuses.set(td.targetId, "pending");
    }
    this.statuses.set(deploymentId, { deploymentId, targetStatuses });

    // Execute in order
    const sortedTargets = [...plan.targets].sort((a, b) => a.order - b.order);

    for (const td of sortedTargets) {
      targetStatuses.set(td.targetId, "in-progress");

      let failed = false;
      for (const ref of td.artifactRefs) {
        const result = await this.agent.deploy(td.targetId, ref.packageName, ref.version);
        if (!result.ok) {
          targetStatuses.set(td.targetId, "failed");

          const record: DeploymentRecord = {
            id: `rec-${nextRecordId++}`,
            targetId: td.targetId,
            artifactVersion: ref.version,
            packageName: ref.packageName,
            deployedAt: new Date(),
            deployedBy: this.operator,
            outcome: "failed",
          };
          records.push(record);
          this.history.add(record);

          // Halt remaining targets
          for (const remaining of sortedTargets) {
            if (remaining.order > td.order) {
              targetStatuses.set(remaining.targetId, "pending");
            }
          }

          return err({ type: "TargetFailed", targetId: td.targetId, reason: result.error });
        }

        const record: DeploymentRecord = {
          id: `rec-${nextRecordId++}`,
          targetId: td.targetId,
          artifactVersion: ref.version,
          packageName: ref.packageName,
          deployedAt: new Date(),
          deployedBy: this.operator,
          outcome: "succeeded",
        };
        records.push(record);
        this.history.add(record);
      }

      if (!failed) {
        targetStatuses.set(td.targetId, "succeeded");
      }
    }

    return ok({ deploymentId, records });
  }

  getStatus(deploymentId: string): DeploymentStatus | undefined {
    return this.statuses.get(deploymentId);
  }

  static resetIdCounters(): void {
    nextDeployId = 1;
    nextRecordId = 1;
  }
}
