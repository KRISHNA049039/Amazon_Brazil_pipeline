import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { ArtifactRepository } from "../../src/build-system/artifact-repository.js";
import { DeploymentExecutor, DeployAgent } from "../../src/deployment-system/deployment-executor.js";
import { DeploymentHistory } from "../../src/deployment-system/deployment-history.js";
import { DeploymentPlan, TargetDeployment } from "../../src/shared/deployment-types.js";
import { ok, err, Result } from "../../src/shared/result.js";

class TrackingDeployAgent implements DeployAgent {
  deployed: Array<{ targetId: string; packageName: string; version: string }> = [];
  failOnTarget?: string;

  async deploy(targetId: string, packageName: string, version: string): Promise<Result<void, string>> {
    this.deployed.push({ targetId, packageName, version });
    if (this.failOnTarget === targetId) {
      return err(`Deploy failed to ${targetId}`);
    }
    return ok(undefined);
  }
}

function makePlan(targets: TargetDeployment[]): DeploymentPlan {
  return { id: `plan-test`, targets, createdAt: new Date() };
}

describe("DeploymentExecutor", () => {
  let history: DeploymentHistory;
  let artifactRepo: ArtifactRepository;
  let agent: TrackingDeployAgent;
  let executor: DeploymentExecutor;

  beforeEach(() => {
    history = new DeploymentHistory();
    artifactRepo = new ArtifactRepository();
    agent = new TrackingDeployAgent();
    executor = new DeploymentExecutor(history, artifactRepo, agent);
    DeploymentExecutor.resetIdCounters();
  });

  // ─── Unit Tests ───

  it("deploys to targets in order", async () => {
    const plan = makePlan([
      { targetId: "staging", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 },
      { targetId: "prod", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 2 },
    ]);

    const result = await executor.execute(plan);
    expect(result.ok).toBe(true);
    expect(agent.deployed[0].targetId).toBe("staging");
    expect(agent.deployed[1].targetId).toBe("prod");
  });

  it("halts on target failure", async () => {
    agent.failOnTarget = "staging";
    const plan = makePlan([
      { targetId: "staging", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 },
      { targetId: "prod", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 2 },
    ]);

    const result = await executor.execute(plan);
    expect(result.ok).toBe(false);
    // prod should not have been deployed to
    expect(agent.deployed.length).toBe(1);
    expect(agent.deployed[0].targetId).toBe("staging");
  });

  it("records deployment history", async () => {
    const plan = makePlan([
      { targetId: "t1", artifactRefs: [{ packageName: "app", version: "1.0.0" }], order: 1 },
    ]);

    await executor.execute(plan);
    const h = history.getHistory("t1");
    expect(h.length).toBe(1);
    expect(h[0].outcome).toBe("succeeded");
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 15: Deployment execution order
  it("Property 15: deployment execution order", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (numTargets) => {
          const h = new DeploymentHistory();
          const ar = new ArtifactRepository();
          const ag = new TrackingDeployAgent();
          const ex = new DeploymentExecutor(h, ar, ag);

          const targets: TargetDeployment[] = [];
          for (let i = 0; i < numTargets; i++) {
            targets.push({
              targetId: `t-${i}`,
              artifactRefs: [{ packageName: "app", version: "1.0.0" }],
              order: i + 1,
            });
          }

          await ex.execute(makePlan(targets));

          // Verify order
          for (let i = 0; i < numTargets; i++) {
            expect(ag.deployed[i].targetId).toBe(`t-${i}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 16: Deployment halts on target failure
  it("Property 16: deployment halts on target failure", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        async (numTargets, failIdx) => {
          const actualFailIdx = Math.min(failIdx, numTargets - 1);
          const h = new DeploymentHistory();
          const ar = new ArtifactRepository();
          const ag = new TrackingDeployAgent();
          ag.failOnTarget = `t-${actualFailIdx}`;
          const ex = new DeploymentExecutor(h, ar, ag);

          const targets: TargetDeployment[] = [];
          for (let i = 0; i < numTargets; i++) {
            targets.push({
              targetId: `t-${i}`,
              artifactRefs: [{ packageName: "app", version: "1.0.0" }],
              order: i + 1,
            });
          }

          const result = await ex.execute(makePlan(targets));
          expect(result.ok).toBe(false);

          // Only targets up to and including the failed one should have been attempted
          expect(ag.deployed.length).toBe(actualFailIdx + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
