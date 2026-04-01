import { Result, ok, err } from "../shared/result.js";
import { DeploymentRecord } from "../shared/deployment-types.js";
import { RollbackError } from "../shared/errors.js";
import { DeploymentHistory } from "./deployment-history.js";
import { DeployAgent, DefaultDeployAgent } from "./deployment-executor.js";
import { TargetRegistry } from "./target-registry.js";

let nextRollbackRecordId = 1;

export class RollbackManager {
  constructor(
    private history: DeploymentHistory,
    private targetRegistry: TargetRegistry,
    private agent: DeployAgent = new DefaultDeployAgent(),
    private operator: string = "system"
  ) {}

  async rollback(targetId: string): Promise<Result<DeploymentRecord, RollbackError>> {
    const target = this.targetRegistry.get(targetId);
    if (!target) {
      return err({ type: "TargetNotFound", targetId });
    }

    const previous = this.history.getPrevious(targetId);
    if (!previous) {
      return err({ type: "NoHistory", targetId });
    }

    const result = await this.agent.deploy(targetId, previous.packageName, previous.artifactVersion);
    if (!result.ok) {
      return err({ type: "DeployFailed", targetId, reason: result.error });
    }

    const record: DeploymentRecord = {
      id: `rb-${nextRollbackRecordId++}`,
      targetId,
      artifactVersion: previous.artifactVersion,
      packageName: previous.packageName,
      deployedAt: new Date(),
      deployedBy: this.operator,
      outcome: "rolled-back",
    };

    this.history.add(record);
    return ok(record);
  }

  getHistory(targetId: string, limit?: number): DeploymentRecord[] {
    return this.history.getHistory(targetId, limit);
  }

  static resetIdCounter(): void {
    nextRollbackRecordId = 1;
  }
}
