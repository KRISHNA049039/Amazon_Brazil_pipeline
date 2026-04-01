import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { ArtifactRepository } from "../../src/build-system/artifact-repository.js";
import { DeploymentPlanCreator } from "../../src/deployment-system/deployment-plan-creator.js";
import { TargetRegistry } from "../../src/deployment-system/target-registry.js";

describe("DeploymentPlanCreator", () => {
  let artifactRepo: ArtifactRepository;
  let targetRegistry: TargetRegistry;
  let creator: DeploymentPlanCreator;

  beforeEach(() => {
    artifactRepo = new ArtifactRepository();
    targetRegistry = new TargetRegistry();
    creator = new DeploymentPlanCreator(artifactRepo, targetRegistry);
    DeploymentPlanCreator.resetIdCounter();
  });

  function publishArtifact(name: string, version: string) {
    artifactRepo.publish(
      { packageName: name, version, data: new Uint8Array([1]) },
      { buildTimestamp: new Date(), sourceCommitHash: "abc" }
    );
  }

  function registerTarget(id: string, reachable = true) {
    targetRegistry.register({ id, name: id, environment: "staging", reachable });
  }

  // ─── Unit Tests ───

  it("creates a valid deployment plan", () => {
    publishArtifact("app", "1.0.0");
    registerTarget("staging");

    const result = creator.create({
      artifacts: [{ packageName: "app", version: "1.0.0" }],
      targets: [{ targetId: "staging", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects plan with missing artifacts", () => {
    registerTarget("staging");
    const result = creator.create({
      artifacts: [{ packageName: "missing", version: "1.0.0" }],
      targets: [{ targetId: "staging", artifactRefs: [{ packageName: "missing", version: "1.0.0" }], order: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects plan with unreachable targets", () => {
    publishArtifact("app", "1.0.0");
    registerTarget("down", false);

    const result = creator.create({
      artifacts: [{ packageName: "app", version: "1.0.0" }],
      targets: [{ targetId: "down", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects plan with unregistered targets", () => {
    publishArtifact("app", "1.0.0");
    const result = creator.create({
      artifacts: [{ packageName: "app", version: "1.0.0" }],
      targets: [{ targetId: "ghost", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("single target plan", () => {
    publishArtifact("solo", "1.0.0");
    registerTarget("t1");
    const result = creator.create({
      artifacts: [{ packageName: "solo", version: "1.0.0" }],
      targets: [{ targetId: "t1", artifactRefs: [{ packageName: "solo", version: "1.0.0" }], order: 1 }],
    });
    expect(result.ok).toBe(true);
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 14: Deployment plan validation
  it("Property 14: deployment plan validation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        fc.boolean(),
        (numArtifacts, numTargets, artifactsExist, targetsReachable) => {
          const ar = new ArtifactRepository();
          const tr = new TargetRegistry();
          const c = new DeploymentPlanCreator(ar, tr);

          const artifacts = [];
          const targetDeploys = [];

          for (let i = 0; i < numArtifacts; i++) {
            const name = `pkg-${i}`;
            const version = "1.0.0";
            if (artifactsExist) {
              ar.publish(
                { packageName: name, version, data: new Uint8Array([1]) },
                { buildTimestamp: new Date(), sourceCommitHash: "abc" }
              );
            }
            artifacts.push({ packageName: name, version });
          }

          for (let i = 0; i < numTargets; i++) {
            const id = `target-${i}`;
            tr.register({ id, name: id, environment: "test", reachable: targetsReachable });
            targetDeploys.push({
              targetId: id,
              artifactRefs: artifacts,
              order: i + 1,
            });
          }

          const result = c.create({ artifacts, targets: targetDeploys });

          if (artifactsExist && targetsReachable) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
