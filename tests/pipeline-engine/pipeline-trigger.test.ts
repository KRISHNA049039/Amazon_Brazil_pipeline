import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { PipelineExecutor } from "../../src/pipeline-engine/pipeline-executor.js";
import { PipelineTrigger } from "../../src/pipeline-engine/pipeline-trigger.js";
import { PipelineLogger } from "../../src/pipeline-engine/pipeline-logger.js";
import { PipelineDefinition, ActionType } from "../../src/shared/pipeline-types.js";
import { ok, Result } from "../../src/shared/result.js";
import { StepActionExecutor } from "../../src/pipeline-engine/pipeline-executor.js";

class SuccessExecutor implements StepActionExecutor {
  async execute(): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

class SlowExecutor implements StepActionExecutor {
  async execute(): Promise<Result<void, string>> {
    // Simulate a long-running step that never completes during the test
    await new Promise((resolve) => setTimeout(resolve, 10));
    return ok(undefined);
  }
}

function makeDef(id: string, repo?: string, branch?: string, allowParallel = false): PipelineDefinition {
  return {
    id,
    name: `Pipeline ${id}`,
    stages: [
      {
        name: "Build",
        steps: [{ name: "compile", action: "build" as ActionType }],
      },
    ],
    trigger: repo ? { repository: repo, branch: branch ?? "main", allowParallelRuns: allowParallel } : undefined,
  };
}

describe("PipelineTrigger", () => {
  let executor: PipelineExecutor;
  let trigger: PipelineTrigger;

  beforeEach(() => {
    executor = new PipelineExecutor(new SuccessExecutor(), new PipelineLogger());
    trigger = new PipelineTrigger(executor);
    PipelineExecutor.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("auto-triggers on commit to monitored branch", async () => {
    const def = makeDef("auto1", "my-repo", "main");
    trigger.registerDefinition(def);

    await trigger.onCommit("my-repo", "main", "abc123");

    const log = executor.getLogger().getDefinitionHistory("auto1");
    expect(log.length).toBe(1);
  });

  it("ignores commits to unmonitored branches", async () => {
    const def = makeDef("auto2", "my-repo", "main");
    trigger.registerDefinition(def);

    await trigger.onCommit("my-repo", "develop", "abc123");

    const log = executor.getLogger().getDefinitionHistory("auto2");
    expect(log.length).toBe(0);
  });

  it("manual trigger creates a run", async () => {
    const def = makeDef("manual1");
    trigger.registerDefinition(def);

    const result = await trigger.manualTrigger("manual1", "commit-xyz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitRef).toBe("commit-xyz");
    }
  });

  it("manual trigger uses latest commit when none specified", async () => {
    const def = makeDef("manual2", "repo", "main");
    trigger.registerDefinition(def);

    const result = await trigger.manualTrigger("manual2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commitRef).toBe("latest-main");
    }
  });

  it("rejects manual trigger for unknown definition", async () => {
    const result = await trigger.manualTrigger("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("DefinitionNotFound");
  });

  it("prevents concurrent runs when disabled", async () => {
    // Use a slow executor so the first run is still "running" when we try the second
    const slowExec = new PipelineExecutor(new SlowExecutor(), new PipelineLogger());
    const slowTrigger = new PipelineTrigger(slowExec);

    const def = makeDef("conc1", "repo", "main", false);
    slowTrigger.registerDefinition(def);

    // Start first run (don't await)
    const firstPromise = slowTrigger.manualTrigger("conc1", "c1");

    // Try second run while first is in progress
    const secondResult = await slowTrigger.manualTrigger("conc1", "c2");
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) expect(secondResult.error.type).toBe("ConcurrentRun");

    await firstPromise;
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 25: Automatic pipeline triggering
  it("Property 25: automatic pipeline triggering", () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.hexaString({ minLength: 6, maxLength: 20 }),
        async (repo, branch, commitRef) => {
          const exec = new PipelineExecutor(new SuccessExecutor(), new PipelineLogger());
          const trig = new PipelineTrigger(exec);

          const def = makeDef(`auto-${Math.random()}`, repo, branch);
          trig.registerDefinition(def);

          await trig.onCommit(repo, branch, commitRef);

          const history = exec.getLogger().getDefinitionHistory(def.id);
          expect(history.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 26: Manual trigger uses correct commit
  it("Property 26: manual trigger uses correct commit", () => {
    fc.assert(
      fc.asyncProperty(
        fc.hexaString({ minLength: 6, maxLength: 40 }),
        async (commitRef) => {
          const exec = new PipelineExecutor(new SuccessExecutor(), new PipelineLogger());
          const trig = new PipelineTrigger(exec);

          const def = makeDef(`manual-${Math.random()}`);
          trig.registerDefinition(def);

          const result = await trig.manualTrigger(def.id, commitRef);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.commitRef).toBe(commitRef);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 27: Concurrent run prevention
  it("Property 27: concurrent run prevention", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (_n) => {
        const slowExec = new PipelineExecutor(new SlowExecutor(), new PipelineLogger());
        const trig = new PipelineTrigger(slowExec);

        const def = makeDef(`conc-${Math.random()}`, "repo", "main", false);
        trig.registerDefinition(def);

        // Start first run
        const firstPromise = trig.manualTrigger(def.id, "c1");

        // Second should be rejected
        const second = await trig.manualTrigger(def.id, "c2");
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.error.type).toBe("ConcurrentRun");

        await firstPromise;
      }),
      { numRuns: 100 }
    );
  });
});
