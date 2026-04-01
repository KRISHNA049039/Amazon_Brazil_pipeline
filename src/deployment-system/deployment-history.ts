import { DeploymentRecord } from "../shared/deployment-types.js";

export class DeploymentHistory {
  private records = new Map<string, DeploymentRecord[]>();

  add(record: DeploymentRecord): void {
    const list = this.records.get(record.targetId) ?? [];
    list.push(record);
    this.records.set(record.targetId, list);
  }

  getHistory(targetId: string, limit?: number): DeploymentRecord[] {
    const list = this.records.get(targetId) ?? [];
    // Return in reverse chronological order (newest first)
    const sorted = [...list].sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime());
    return limit ? sorted.slice(0, limit) : sorted;
  }

  getLatest(targetId: string): DeploymentRecord | undefined {
    const history = this.getHistory(targetId, 1);
    return history[0];
  }

  getPrevious(targetId: string): DeploymentRecord | undefined {
    const history = this.getHistory(targetId, 2);
    return history[1];
  }

  count(targetId: string): number {
    return (this.records.get(targetId) ?? []).length;
  }
}
