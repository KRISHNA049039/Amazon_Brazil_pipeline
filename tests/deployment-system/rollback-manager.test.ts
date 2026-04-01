import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { RollbackManager } from "../../src/deployment-system/rollback-manager.js";
import { DeploymentHistory } from "../../src/deployment-system/deployment-history.js";
import { TargetRegistry } from "../../src/deployment-system/target-registry.js";
import { DeployAgent } from "../../src/deployment-system/deployment-executor.js";
import { DeploymentRecord } from "../../src/shared/deployment-types.js";
import { ok, Result } from "../../src/shared/result.js";

class SuccessAgent implements DeployAgent {
  async deploy(): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

function addRecord(history: DeploymentHistory, targetId: string, version: string, idx: number): void {
  const record: DeploymentRecord = {
    id: `rec-${idx}`,
    targetId,
    artifactVersion: version,
    packageName: "app",
    deployedAt: new Date(Date.now() - (1000 - idx) * 1000), // past timestamps, increasing
    deployedBy: "operator",
    outcome: "succeeded",
  };
  history.add(record);
}

describe("RollbackManager", () => {
  let history: DeploymentHistory;
  let targetRegistry: TargetRegistry;
  let manager: RollbackManager;

  beforeEach(() => {
    history = new DeploymentHistory();
    targetRegistry = new TargetRegistry();
    targetRegistry.register({ id: "t1", name: "staging", environment: "staging", reachable: true });
    manager = new RollbackManager(history, targetRegistry, new SuccessAgent());
    RollbackManager.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("rolls back to previous version", async () => {
    addRecord(history, "t1", "1.0.0", 0);
    addRecord(history, "t1", "2.0.0", 1);

    const result = await manager.rollback("t1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifactVersion).toBe("1.0.0");
      expect(result.value.outcome).toBe("rolled-back");
    }
  });

  it("rejects rollback with no history", async () => {
    addRecord(history, "t1", "1.0.0", 0); // only one record, no previous
    const result = await manager.rollback("t1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("NoHistory");
  });

  it("rejects rollback for unknown target", async () => {
    const result = await manager.rollback("unknown");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("TargetNotFound");
  });

  it("rollback adds history entry", async () => {
    addRecord(history, "t1", "1.0.0", 0);
    addRecord(history, "t1", "2.0.0", 1);

    const countBefore = history.count("t1");
    await manager.rollback("t1");
    expect(history.count("t1")).toBe(countBefore + 1);
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 17: Rollback redeploys previous version
  it("Property 17: rollback redeploys previous version", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        async (numDeploys) => {
          const h = new DeploymentHistory();
          const tr = new TargetRegistry();
          tr.register({ id: "target", name: "target", environment: "test", reachable: true });
          const mgr = new RollbackManager(h, tr, new SuccessAgent());

          const versions: string[] = [];
          for (let i = 0; i < numDeploys; i++) {
            const v = `${i + 1}.0.0`;
            versions.push(v);
            addRecord(h, "target", v, i);
          }

          const result = await mgr.rollback("target");
          expect(result.ok).toBe(true);
          if (result.ok) {
            // Should redeploy the second-to-last version
            expect(result.value.artifactVersion).toBe(versions[numDeploys - 2]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 18: Deployment history minimum retention
  it("Property 18: deployment history minimum retention", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (numDeploys) => {
        const h = new DeploymentHistory();
        for (let i = 0; i < numDeploys; i++) {
          addRecord(h, "target", `${i}.0.0`, i);
        }

        const records = h.getHistory("target");
        // Should retain all records (at least 10 or all if fewer)
        expect(records.length).toBe(numDeploys);
        if (numDeploys >= 10) {
          expect(records.length).toBeGreaterThanOrEqual(10);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 19: Rollback creates history entry
  it("Property 19: rollback creates history entry", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (numDeploys) => {
        const h = new DeploymentHistory();
        const tr = new TargetRegistry();
        tr.register({ id: "t", name: "t", environment: "test", reachable: true });
        const mgr = new RollbackManager(h, tr, new SuccessAgent());

        for (let i = 0; i < numDeploys; i++) {
          addRecord(h, "t", `${i}.0.0`, i);
        }

        const countBefore = h.count("t");
        // Small delay to ensure rollback timestamp is after the last record
        await new Promise((r) => setTimeout(r, 5));
        const result = await mgr.rollback("t");
        expect(result.ok).toBe(true);
        expect(h.count("t")).toBe(countBefore + 1);

        // The newest entry should be the rollback
        const allHistory = h.getHistory("t");
        const latest = allHistory[0];
        expect(latest.outcome).toBe("rolled-back");
      }),
      { numRuns: 100 }
    );
  });
});
