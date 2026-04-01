import { Result, ok, err } from "../shared/result.js";
import {
  PipelineDefinition,
  PipelineRun,
} from "../shared/pipeline-types.js";
import { PipelineError } from "../shared/errors.js";
import { PipelineLogger } from "./pipeline-logger.js";

export interface StepActionExecutor {
  execute(action: string, script?: string): Promise<Result<void, string>>;
}

export class DefaultStepActionExecutor implements StepActionExecutor {
  async execute(_action: string, _script?: string): Promise<Result<void, string>> {
    return ok(undefined);
  }
}

/** Interface for handling manual approval steps */
export interface ApprovalProvider {
  /** Called when an approval step is reached. Resolves when approved/rejected. */
  waitForApproval(
    runId: string,
    stageName: string,
    stepName: string,
    message?: string
  ): Promise<{ approved: boolean; approvedBy: string; comment?: string }>;
}

/** Default auto-approve provider for testing */
export class AutoApprovalProvider implements ApprovalProvider {
  async waitForApproval(
    _runId: string,
    _stageName: string,
    _stepName: string,
    _message?: string
  ): Promise<{ approved: boolean; approvedBy: string }> {
    return { approved: true, approvedBy: "auto" };
  }
}

/**
 * Callback-based approval provider. Registers pending approvals and resolves
 * them when approve() or reject() is called externally (e.g. from a UI).
 */
export class CallbackApprovalProvider implements ApprovalProvider {
  private pending = new Map<
    string,
    { resolve: (v: { approved: boolean; approvedBy: string; comment?: string }) => void; stageName: string; stepName: string; message?: string }
  >();

  waitForApproval(
    runId: string,
    stageName: string,
    stepName: string,
    message?: string
  ): Promise<{ approved: boolean; approvedBy: string; comment?: string }> {
    const key = `${runId}:${stageName}:${stepName}`;
    return new Promise((resolve) => {
      this.pending.set(key, { resolve, stageName, stepName, message });
    });
  }

  approve(runId: string, stageName: string, stepName: string, approvedBy: string, comment?: string): boolean {
    const key = `${runId}:${stageName}:${stepName}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.resolve({ approved: true, approvedBy, comment });
    this.pending.delete(key);
    return true;
  }

  reject(runId: string, stageName: string, stepName: string, rejectedBy: string, comment?: string): boolean {
    const key = `${runId}:${stageName}:${stepName}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.resolve({ approved: false, approvedBy: rejectedBy, comment });
    this.pending.delete(key);
    return true;
  }

  getPendingApprovals(): Array<{ runId: string; stageName: string; stepName: string; message?: string }> {
    const result: Array<{ runId: string; stageName: string; stepName: string; message?: string }> = [];
    for (const [key, val] of this.pending) {
      const [runId, stageName, stepName] = key.split(":");
      result.push({ runId, stageName, stepName, message: val.message });
    }
    return result;
  }
}

let nextRunId = 1;

export class PipelineExecutor {
  private definitions = new Map<string, PipelineDefinition>();
  private runs = new Map<string, PipelineRun>();
  private activeRuns = new Map<string, string>();

  constructor(
    private actionExecutor: StepActionExecutor = new DefaultStepActionExecutor(),
    private logger: PipelineLogger = new PipelineLogger(),
    private approvalProvider: ApprovalProvider = new AutoApprovalProvider()
  ) {}

  registerDefinition(def: PipelineDefinition): void {
    this.definitions.set(def.id, def);
  }

  async execute(
    definitionId: string,
    commitRef?: string
  ): Promise<Result<PipelineRun, PipelineError>> {
    const def = this.definitions.get(definitionId);
    if (!def) {
      return err({ type: "DefinitionNotFound", definitionId });
    }

    const runId = `run-${nextRunId++}`;
    const run: PipelineRun = {
      id: runId,
      definitionId,
      commitRef: commitRef ?? "HEAD",
      status: "running",
      stages: def.stages.map((s) => ({
        stageName: s.name,
        status: "pending",
        steps: s.steps.map((st) => ({
          stepName: st.name,
          action: st.action,
          status: "pending",
          approvalMessage: st.action === "approval" ? st.approvalMessage : undefined,
          approvalStatus: st.action === "approval" ? "pending" as const : undefined,
        })),
        inputArtifacts: s.inputArtifacts ? [...s.inputArtifacts] : undefined,
        outputArtifacts: s.outputArtifacts ? [...s.outputArtifacts] : undefined,
      })),
      startedAt: new Date(),
    };

    this.runs.set(runId, run);
    this.activeRuns.set(definitionId, runId);
    this.logger.setRunMeta(runId, definitionId, run);

    this.logger.log(runId, {
      timestamp: new Date(),
      level: "info",
      message: `Pipeline run ${runId} started for definition ${definitionId}`,
    });

    for (let si = 0; si < run.stages.length; si++) {
      const stageRun = run.stages[si];
      stageRun.status = "running";
      stageRun.startedAt = new Date();

      this.logger.log(runId, {
        timestamp: new Date(),
        level: "info",
        message: `Stage "${stageRun.stageName}" started`,
        stageIndex: si,
      });

      const stageDef = def.stages[si];
      let stageFailed = false;

      const parallelSteps: number[] = [];
      const sequentialSteps: number[] = [];
      for (let j = 0; j < stageDef.steps.length; j++) {
        if (stageDef.steps[j].parallel) {
          parallelSteps.push(j);
        } else {
          sequentialSteps.push(j);
        }
      }

      // Execute parallel steps concurrently
      if (parallelSteps.length > 0) {
        const promises = parallelSteps.map(async (j) => {
          const stepRun = stageRun.steps[j];
          const stepDef = stageDef.steps[j];
          stepRun.status = "running";
          stepRun.startedAt = new Date();

          const result = await this.executeStep(runId, stageRun.stageName, stepDef, stepRun);
          stepRun.completedAt = new Date();

          if (!result.ok) {
            stepRun.status = "failed";
            stepRun.error = result.error;
            return { index: j, failed: true, error: result.error };
          }
          stepRun.status = "succeeded";
          return { index: j, failed: false };
        });

        const results = await Promise.all(promises);
        for (const r of results) {
          if (r.failed) {
            stageFailed = true;
            this.logger.log(runId, {
              timestamp: new Date(),
              level: "error",
              message: `Step "${stageRun.steps[r.index].stepName}" failed: ${r.error}`,
              stageIndex: si,
              stepIndex: r.index,
            });
          }
        }
      }

      // Execute sequential steps
      if (!stageFailed) {
        for (const j of sequentialSteps) {
          const stepRun = stageRun.steps[j];
          const stepDef = stageDef.steps[j];
          stepRun.status = "running";
          stepRun.startedAt = new Date();

          const result = await this.executeStep(runId, stageRun.stageName, stepDef, stepRun);
          stepRun.completedAt = new Date();

          if (!result.ok) {
            stepRun.status = "failed";
            stepRun.error = result.error;
            stageFailed = true;

            this.logger.log(runId, {
              timestamp: new Date(),
              level: "error",
              message: `Step "${stepRun.stepName}" failed: ${result.error}`,
              stageIndex: si,
              stepIndex: j,
            });
            break;
          }
          stepRun.status = "succeeded";
        }
      }

      stageRun.completedAt = new Date();

      if (stageFailed) {
        stageRun.status = "failed";
        run.status = "failed";
        run.completedAt = new Date();

        for (let k = si + 1; k < run.stages.length; k++) {
          run.stages[k].status = "skipped";
          for (const step of run.stages[k].steps) {
            step.status = "skipped";
          }
        }

        this.logger.setRunMeta(runId, definitionId, run);
        this.activeRuns.delete(definitionId);

        const failedStep = stageRun.steps.find((s) => s.status === "failed");
        return err({
          type: "StepFailed",
          stageName: stageRun.stageName,
          stepName: failedStep?.stepName ?? "unknown",
          reason: failedStep?.error ?? "unknown",
        });
      }

      stageRun.status = "succeeded";
    }

    run.status = "succeeded";
    run.completedAt = new Date();
    this.logger.setRunMeta(runId, definitionId, run);
    this.activeRuns.delete(definitionId);

    this.logger.log(runId, {
      timestamp: new Date(),
      level: "info",
      message: `Pipeline run ${runId} succeeded`,
    });

    return ok(run);
  }

  private async executeStep(
    runId: string,
    stageName: string,
    stepDef: { name: string; action: string; script?: string; approvalMessage?: string },
    stepRun: { approvalStatus?: "pending" | "approved" | "rejected"; approvedBy?: string }
  ): Promise<Result<void, string>> {
    if (stepDef.action === "approval") {
      const decision = await this.approvalProvider.waitForApproval(
        runId,
        stageName,
        stepDef.name,
        stepDef.approvalMessage
      );
      if (decision.approved) {
        stepRun.approvalStatus = "approved";
        stepRun.approvedBy = decision.approvedBy;
        return ok(undefined);
      } else {
        stepRun.approvalStatus = "rejected";
        stepRun.approvedBy = decision.approvedBy;
        return err(`Approval rejected by ${decision.approvedBy}`);
      }
    }

    return this.actionExecutor.execute(stepDef.action, stepDef.script);
  }

  getStatus(runId: string): PipelineRun | undefined {
    return this.runs.get(runId);
  }

  getRun(runId: string): PipelineRun | undefined {
    return this.runs.get(runId);
  }

  getAllRuns(): PipelineRun[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }

  getDefinition(definitionId: string): PipelineDefinition | undefined {
    return this.definitions.get(definitionId);
  }

  getAllDefinitions(): PipelineDefinition[] {
    return Array.from(this.definitions.values());
  }

  isRunning(definitionId: string): boolean {
    return this.activeRuns.has(definitionId);
  }

  getLogger(): PipelineLogger {
    return this.logger;
  }

  static resetIdCounter(): void {
    nextRunId = 1;
  }
}
