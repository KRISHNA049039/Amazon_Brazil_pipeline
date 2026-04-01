import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { PipelineExecutor, StepActionExecutor } from "../../src/pipeline-engine/pipeline-executor.js";
import { PipelineLogger } from "../../src/pipeline-engine/pipeline-logger.js";
import { PipelineDefinition, ActionType } from "../../src/shared/pipeline-types.js";
import { ok, err, Result } from "../../src/shared/result.js";

class TrackingActionExecutor implements StepActionExecutor {
  executed: string[] = [];
  failOnStep?: string;

  async execute(action: string, script?: string): Promise<Result<void, string>> {
    const key = script ?? action;
    this.executed.push(key);
    if (this.failOnStep === key) {
      return err(`Step failed: ${key}`);
    }
    return ok(undefined);
  }
}

function makeDef(
  id: string,
  stages: Array<{ name: string; steps: Array<{ name: string; action: ActionType; parallel?: boolean; script?: string }> }>
): PipelineDefinition {
  return {
    id,
    name: `Pipeline ${id}`,
    stages: stages.map((s) => ({
      name: s.name,
      steps: s.steps.map((st) => ({
        name: st.name,
        action: st.action,
        parallel: st.parallel,
        script: st.script,
      })),
    })),
  };
}

describe("PipelineExecutor", () => {
  let tracker: TrackingActionExecutor;
  let logger: PipelineLogger;
  let executor: PipelineExecutor;

  beforeEach(() => {
    tracker = new TrackingActionExecutor();
    logger = new PipelineLogger();
    executor = new PipelineExecutor(tracker, logger);
    PipelineExecutor.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("executes stages in order", async () => {
    const def = makeDef("p1", [
      { name: "Build", steps: [{ name: "compile", action: "build", script: "s1" }] },
      { name: "Test", steps: [{ name: "unit", action: "test", script: "s2" }] },
      { name: "Deploy", steps: [{ name: "release", action: "deploy", script: "s3" }] },
    ]);
    executor.registerDefinition(def);

    const result = await executor.execute("p1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("succeeded");
      expect(result.value.completedAt).toBeDefined();
    }
    expect(tracker.executed).toEqual(["s1", "s2", "s3"]);
  });

  it("halts on step failure", async () => {
    tracker.failOnStep = "s2";
    const def = makeDef("p2", [
      { name: "Build", steps: [{ name: "compile", action: "build", script: "s1" }] },
      { name: "Test", steps: [{ name: "unit", action: "test", script: "s2" }] },
      { name: "Deploy", steps: [{ name: "release", action: "deploy", script: "s3" }] },
    ]);
    executor.registerDefinition(def);

    const result = await executor.execute("p2");
    expect(result.ok).toBe(false);
    expect(tracker.executed).toEqual(["s1", "s2"]);
  });

  it("marks skipped stages after failure", async () => {
    tracker.failOnStep = "s1";
    const def = makeDef("p3", [
      { name: "Build", steps: [{ name: "compile", action: "build", script: "s1" }] },
      { name: "Test", steps: [{ name: "unit", action: "test", script: "s2" }] },
    ]);
    executor.registerDefinition(def);

    await executor.execute("p3");
    const run = executor.getStatus("run-1");
    expect(run?.stages[1].status).toBe("skipped");
  });

  it("returns error for unknown definition", async () => {
    const result = await executor.execute("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("DefinitionNotFound");
  });

  it("executes parallel steps concurrently", async () => {
    const def = makeDef("p4", [
      {
        name: "Parallel Stage",
        steps: [
          { name: "a", action: "test", parallel: true, script: "pa" },
          { name: "b", action: "test", parallel: true, script: "pb" },
        ],
      },
    ]);
    executor.registerDefinition(def);

    const result = await executor.execute("p4");
    expect(result.ok).toBe(true);
    // Both should have executed
    expect(tracker.executed).toContain("pa");
    expect(tracker.executed).toContain("pb");
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 22: Pipeline stage execution order and success status
  it("Property 22: stage execution order and success status", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        async (numStages) => {
          const track = new TrackingActionExecutor();
          const log = new PipelineLogger();
          const exec = new PipelineExecutor(track, log);

          const stages = [];
          for (let i = 0; i < numStages; i++) {
            stages.push({
              name: `Stage-${i}`,
              steps: [{ name: `step-${i}`, action: "build" as ActionType, script: `cmd-${i}` }],
            });
          }

          const def = makeDef(`prop22-${numStages}`, stages);
          exec.registerDefinition(def);

          const result = await exec.execute(def.id);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.status).toBe("succeeded");
            expect(result.value.completedAt).toBeDefined();
            // Verify order
            for (let i = 0; i < numStages; i++) {
              expect(track.executed[i]).toBe(`cmd-${i}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 23: Parallel steps within a stage
  it("Property 23: parallel steps within a stage", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        async (numParallel) => {
          const track = new TrackingActionExecutor();
          const log = new PipelineLogger();
          const exec = new PipelineExecutor(track, log);

          const steps = [];
          for (let i = 0; i < numParallel; i++) {
            steps.push({
              name: `par-${i}`,
              action: "test" as ActionType,
              parallel: true,
              script: `par-cmd-${i}`,
            });
          }

          const def = makeDef(`prop23-${numParallel}`, [{ name: "Parallel", steps }]);
          exec.registerDefinition(def);

          const result = await exec.execute(def.id);
          expect(result.ok).toBe(true);

          // All parallel steps should have executed
          for (let i = 0; i < numParallel; i++) {
            expect(track.executed).toContain(`par-cmd-${i}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 24: Pipeline halts on step failure
  it("Property 24: pipeline halts on step failure", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        async (numStages, failIdx) => {
          const actualFailIdx = Math.min(failIdx, numStages - 1);
          const track = new TrackingActionExecutor();
          track.failOnStep = `cmd-${actualFailIdx}`;
          const log = new PipelineLogger();
          const exec = new PipelineExecutor(track, log);

          const stages = [];
          for (let i = 0; i < numStages; i++) {
            stages.push({
              name: `Stage-${i}`,
              steps: [{ name: `step-${i}`, action: "build" as ActionType, script: `cmd-${i}` }],
            });
          }

          const def = makeDef(`prop24-${numStages}-${actualFailIdx}`, stages);
          exec.registerDefinition(def);

          const result = await exec.execute(def.id);
          expect(result.ok).toBe(false);

          // Steps after failure should not execute
          expect(track.executed.length).toBe(actualFailIdx + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
