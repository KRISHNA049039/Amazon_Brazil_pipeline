import { describe, it, expect, beforeEach } from "vitest";
import {
  PipelineExecutor,
  CallbackApprovalProvider,
  AutoApprovalProvider,
  StepActionExecutor,
} from "../../src/pipeline-engine/pipeline-executor.js";
import { PipelineLogger } from "../../src/pipeline-engine/pipeline-logger.js";
import { PipelineDefinition, ActionType } from "../../src/shared/pipeline-types.js";
import { ok, Result } from "../../src/shared/result.js";

class SuccessExecutor implements StepActionExecutor {
  async execute(): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

function makeDef(id: string, hasApproval: boolean): PipelineDefinition {
  const stages: PipelineDefinition["stages"] = [
    {
      name: "Build",
      steps: [{ name: "Compile", action: "build" as ActionType }],
      outputArtifacts: [{ name: "BuildOutput", packageName: "app", version: "1.0.0" }],
    },
  ];

  if (hasApproval) {
    stages.push({
      name: "Approval Gate",
      steps: [
        {
          name: "Prod Approval",
          action: "approval" as ActionType,
          approvalMessage: "Approve for production?",
        },
      ],
    });
  }

  stages.push({
    name: "Deploy",
    steps: [{ name: "Deploy Prod", action: "deploy" as ActionType }],
    inputArtifacts: [{ name: "BuildOutput" }],
  });

  return { id, name: `Pipeline ${id}`, stages };
}

describe("Pipeline Approval", () => {
  // ─── Auto-approval ───

  it("auto-approval provider approves immediately", async () => {
    const exec = new PipelineExecutor(
      new SuccessExecutor(),
      new PipelineLogger(),
      new AutoApprovalProvider()
    );
    exec.registerDefinition(makeDef("auto", true));

    const result = await exec.execute("auto");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("succeeded");
      const approvalStage = result.value.stages[1];
      expect(approvalStage.status).toBe("succeeded");
      expect(approvalStage.steps[0].approvalStatus).toBe("approved");
      expect(approvalStage.steps[0].approvedBy).toBe("auto");
    }
  });

  // ─── Callback-based approval ───

  it("callback approval blocks until approved", async () => {
    PipelineExecutor.resetIdCounter();
    const provider = new CallbackApprovalProvider();
    const exec = new PipelineExecutor(new SuccessExecutor(), new PipelineLogger(), provider);
    exec.registerDefinition(makeDef("cb-approve", true));

    // Start execution (will block at approval)
    const promise = exec.execute("cb-approve");

    // Wait a tick for the pipeline to reach the approval step
    await new Promise((r) => setTimeout(r, 50));

    // Check pending approvals
    const pending = provider.getPendingApprovals();
    expect(pending.length).toBe(1);
    expect(pending[0].stageName).toBe("Approval Gate");
    expect(pending[0].stepName).toBe("Prod Approval");
    expect(pending[0].message).toBe("Approve for production?");

    // Approve it using the actual runId from pending
    const runId = pending[0].runId;
    const approved = provider.approve(runId, "Approval Gate", "Prod Approval", "test-user");
    expect(approved).toBe(true);

    const result = await promise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("succeeded");
      expect(result.value.stages[1].steps[0].approvalStatus).toBe("approved");
      expect(result.value.stages[1].steps[0].approvedBy).toBe("test-user");
      // Deploy stage should have run after approval
      expect(result.value.stages[2].status).toBe("succeeded");
    }
  });

  it("callback rejection fails the pipeline", async () => {
    PipelineExecutor.resetIdCounter();
    const provider = new CallbackApprovalProvider();
    const exec = new PipelineExecutor(new SuccessExecutor(), new PipelineLogger(), provider);
    exec.registerDefinition(makeDef("cb-reject", true));

    const promise = exec.execute("cb-reject");
    await new Promise((r) => setTimeout(r, 50));

    const pending = provider.getPendingApprovals();
    expect(pending.length).toBe(1);
    const runId = pending[0].runId;

    provider.reject(runId, "Approval Gate", "Prod Approval", "cautious-user");

    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("StepFailed");
      if (result.error.type === "StepFailed") {
        expect(result.error.stageName).toBe("Approval Gate");
      }
    }

    // Deploy stage should be skipped
    const run = exec.getStatus(runId);
    expect(run?.stages[2].status).toBe("skipped");
  });

  // ─── Stage artifacts ───

  it("stage artifacts are preserved in run", async () => {
    const exec = new PipelineExecutor(
      new SuccessExecutor(),
      new PipelineLogger(),
      new AutoApprovalProvider()
    );
    exec.registerDefinition(makeDef("artifacts", false));

    const result = await exec.execute("artifacts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Build stage has output artifact
      expect(result.value.stages[0].outputArtifacts).toBeDefined();
      expect(result.value.stages[0].outputArtifacts![0].name).toBe("BuildOutput");

      // Deploy stage has input artifact
      expect(result.value.stages[1].inputArtifacts).toBeDefined();
      expect(result.value.stages[1].inputArtifacts![0].name).toBe("BuildOutput");
    }
  });

  it("pipeline without approval runs straight through", async () => {
    const exec = new PipelineExecutor(
      new SuccessExecutor(),
      new PipelineLogger(),
      new AutoApprovalProvider()
    );
    exec.registerDefinition(makeDef("no-approval", false));

    const result = await exec.execute("no-approval");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stages.length).toBe(2); // Build + Deploy, no approval
      expect(result.value.status).toBe("succeeded");
    }
  });

  // ─── CallbackApprovalProvider edge cases ───

  it("approve returns false for non-pending approval", () => {
    const provider = new CallbackApprovalProvider();
    expect(provider.approve("x", "y", "z", "user")).toBe(false);
  });

  it("getPendingApprovals returns empty when none pending", () => {
    const provider = new CallbackApprovalProvider();
    expect(provider.getPendingApprovals()).toEqual([]);
  });
});
