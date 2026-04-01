import { Result, ok, err } from "../shared/result.js";
import { DeploymentPlanSpec, DeploymentPlan } from "../shared/deployment-types.js";
import { PlanError } from "../shared/errors.js";
import { ArtifactRepository } from "../build-system/artifact-repository.js";
import { TargetRegistry } from "./target-registry.js";

let nextPlanId = 1;

export class DeploymentPlanCreator {
  constructor(
    private artifactRepo: ArtifactRepository,
    private targetRegistry: TargetRegistry
  ) {}

  create(spec: DeploymentPlanSpec): Result<DeploymentPlan, PlanError> {
    const invalidArtifacts: Array<{ packageName: string; version: string }> = [];
    const invalidTargets: string[] = [];

    // Validate artifacts
    for (const ref of spec.artifacts) {
      if (!this.artifactRepo.exists(ref.packageName, ref.version)) {
        invalidArtifacts.push({ packageName: ref.packageName, version: ref.version });
      }
    }

    // Validate targets
    const seenTargets = new Set<string>();
    for (const td of spec.targets) {
      if (!seenTargets.has(td.targetId)) {
        seenTargets.add(td.targetId);
        const target = this.targetRegistry.get(td.targetId);
        if (!target || !target.reachable) {
          invalidTargets.push(td.targetId);
        }
      }
      // Also validate per-target artifact refs
      for (const ref of td.artifactRefs) {
        if (!this.artifactRepo.exists(ref.packageName, ref.version)) {
          const already = invalidArtifacts.some(
            (a) => a.packageName === ref.packageName && a.version === ref.version
          );
          if (!already) {
            invalidArtifacts.push({ packageName: ref.packageName, version: ref.version });
          }
        }
      }
    }

    if (invalidArtifacts.length > 0 && invalidTargets.length > 0) {
      return err({ type: "Mixed", invalidArtifacts, invalidTargets });
    }
    if (invalidArtifacts.length > 0) {
      return err({ type: "InvalidArtifacts", invalidRefs: invalidArtifacts });
    }
    if (invalidTargets.length > 0) {
      return err({ type: "InvalidTargets", invalidTargetIds: invalidTargets });
    }

    const plan: DeploymentPlan = {
      id: `plan-${nextPlanId++}`,
      targets: [...spec.targets].sort((a, b) => a.order - b.order),
      createdAt: new Date(),
    };

    return ok(plan);
  }

  static resetIdCounter(): void {
    nextPlanId = 1;
  }
}
