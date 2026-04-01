import { DeploymentTarget } from "../shared/deployment-types.js";

export class TargetRegistry {
  private targets = new Map<string, DeploymentTarget>();

  register(target: DeploymentTarget): void {
    this.targets.set(target.id, target);
  }

  get(targetId: string): DeploymentTarget | undefined {
    return this.targets.get(targetId);
  }

  list(): DeploymentTarget[] {
    return Array.from(this.targets.values());
  }

  setReachable(targetId: string, reachable: boolean): void {
    const t = this.targets.get(targetId);
    if (t) t.reachable = reachable;
  }
}
