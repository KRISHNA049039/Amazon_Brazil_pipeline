import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { BuildLogger } from "../../src/build-system/build-logger.js";
import { DeploymentHistory } from "../../src/deployment-system/deployment-history.js";
import { PipelineExecutor } from "../../src/pipeline-engine/pipeline-executor.js";
import { PipelineLogger } from "../../src/pipeline-engine/pipeline-logger.js";
import { DeploymentRecord } from "../../src/shared/deployment-types.js";
import { ActionType } from "../../src/shared/pipeline-types.js";
import { ok, Result } from "../../src/shared/result.js";
import { StepActionExecutor } from "../../src/pipeline-engine/pipeline-executor.js";

class SuccessExecutor implements StepActionExecutor {
  async execute(): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

describe("Observability & Logging", () => {
  // ─── Unit Tests ───

  it("build logger records start/end/status/steps", () => {
    const logger = new BuildLogger();
    const start = new Date();
    const end = new Date(start.getTime() + 1000);
    logger.logBuild("pkg-1", start, end, "succeeded", [
      { stepName: "compile", output: "ok", status: "succeeded" },
    ]);

    const logs = logger.getLogsForPackage("pkg-1");
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("succeeded");
    expect(logs[0].stepOutputs.length).toBe(1);
    expect(logs[0].startTime).toEqual(start);
    expect(logs[0].endTime).toEqual(end);
  });

  it("deployment history records version/operator/timestamp/outcome", () => {
    const history = new DeploymentHistory();
    const record: DeploymentRecord = {
      id: "rec-1",
      targetId: "t1",
      artifactVersion: "1.0.0",
      packageName: "app",
      deployedAt: new Date(),
      deployedBy: "operator-1",
      outcome: "succeeded",
    };
    history.add(record);

    const h = history.getHistory("t1");
    expect(h.length).toBe(1);
    expect(h[0].artifactVersion).toBe("1.0.0");
    expect(h[0].deployedBy).toBe("operator-1");
    expect(h[0].outcome).toBe("succeeded");
  });

  it("pipeline logger records status and duration per stage/step", async () => {
    const pLogger = new PipelineLogger();
    const exec = new PipelineExecutor(new SuccessExecutor(), pLogger);

    exec.registerDefinition({
      id: "log-test",
      name: "Log Test",
      stages: [
        {
          name: "Build",
          steps: [{ name: "compile", action: "build" }],
        },
      ],
    });

    await exec.execute("log-test", "abc");

    const log = pLogger.getRunLog("run-1");
    expect(log).toBeDefined();
    if (log) {
      expect(log.summary.status).toBe("succeeded");
      expect(log.summary.startedAt).toBeDefined();
      expect(log.entries.length).toBeGreaterThan(0);
    }
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 28: Build and pipeline log completeness
  it("Property 28: build and pipeline log completeness", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (numStages) => {
          const pLogger = new PipelineLogger();
          const exec = new PipelineExecutor(new SuccessExecutor(), pLogger);

          const stages = [];
          for (let i = 0; i < numStages; i++) {
            stages.push({
              name: `Stage-${i}`,
              steps: [{ name: `step-${i}`, action: "build" as ActionType }],
            });
          }

          exec.registerDefinition({
            id: `log-${numStages}`,
            name: "Log Test",
            stages,
          });

          const result = await exec.execute(`log-${numStages}`, "commit-abc");
          expect(result.ok).toBe(true);

          if (result.ok) {
            const log = pLogger.getRunLog(result.value.id);
            expect(log).toBeDefined();
            if (log) {
              expect(log.summary.status).toBe("succeeded");
              expect(log.summary.startedAt).toBeDefined();
              // Should have log entries
              expect(log.entries.length).toBeGreaterThan(0);
            }
          }

          // Also test build logger
          const bLogger = new BuildLogger();
          const start = new Date();
          const end = new Date(start.getTime() + 100);
          const stepOutputs = [];
          for (let i = 0; i < numStages; i++) {
            stepOutputs.push({ stepName: `step-${i}`, output: "ok", status: "succeeded" });
          }
          bLogger.logBuild("pkg-test", start, end, "succeeded", stepOutputs);

          const bLogs = bLogger.getLogsForPackage("pkg-test");
          expect(bLogs.length).toBe(1);
          expect(bLogs[0].startTime).toEqual(start);
          expect(bLogs[0].endTime).toEqual(end);
          expect(bLogs[0].status).toBe("succeeded");
          expect(bLogs[0].stepOutputs.length).toBe(numStages);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 29: Deployment history record completeness
  it("Property 29: deployment history record completeness", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.constantFrom("succeeded" as const, "failed" as const, "rolled-back" as const),
        (targetId, version, operator, outcome) => {
          const history = new DeploymentHistory();
          const timestamp = new Date();

          const record: DeploymentRecord = {
            id: `rec-${Math.random()}`,
            targetId,
            artifactVersion: version,
            packageName: "app",
            deployedAt: timestamp,
            deployedBy: operator,
            outcome,
          };
          history.add(record);

          const h = history.getHistory(targetId);
          expect(h.length).toBe(1);
          expect(h[0].artifactVersion).toBe(version);
          expect(h[0].deployedBy).toBe(operator);
          expect(h[0].deployedAt).toEqual(timestamp);
          expect(h[0].outcome).toBe(outcome);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 30: History query ordering
  it("Property 30: history query ordering (reverse chronological)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 15 }), (numEntries) => {
        // Test deployment history ordering
        const history = new DeploymentHistory();
        for (let i = 0; i < numEntries; i++) {
          const record: DeploymentRecord = {
            id: `rec-${i}`,
            targetId: "t1",
            artifactVersion: `${i}.0.0`,
            packageName: "app",
            deployedAt: new Date(Date.now() + i * 1000),
            deployedBy: "op",
            outcome: "succeeded",
          };
          history.add(record);
        }

        const h = history.getHistory("t1");
        // Should be newest first
        for (let i = 0; i < h.length - 1; i++) {
          expect(h[i].deployedAt.getTime()).toBeGreaterThanOrEqual(h[i + 1].deployedAt.getTime());
        }

        // Test build logger ordering
        const bLogger = new BuildLogger();
        for (let i = 0; i < numEntries; i++) {
          bLogger.logBuild(
            "pkg",
            new Date(Date.now() + i * 1000),
            new Date(Date.now() + i * 1000 + 100),
            "succeeded",
            []
          );
        }
        const bLogs = bLogger.getLogsForPackage("pkg");
        for (let i = 0; i < bLogs.length - 1; i++) {
          expect(bLogs[i].startTime.getTime()).toBeGreaterThanOrEqual(bLogs[i + 1].startTime.getTime());
        }
      }),
      { numRuns: 100 }
    );
  });
});
