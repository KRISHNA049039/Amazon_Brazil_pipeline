import { Result, ok, err } from "../shared/result.js";
import { PipelineDefinition, PipelineRun } from "../shared/pipeline-types.js";
import { TriggerError } from "../shared/errors.js";
import { PipelineExecutor } from "./pipeline-executor.js";

export class PipelineTrigger {
  private definitions = new Map<string, PipelineDefinition>();
  private repoIndex = new Map<string, string>(); // "repo:branch" -> definitionId
  private concurrencyPolicy = new Map<string, boolean>(); // definitionId -> allowParallel

  constructor(private executor: PipelineExecutor) {}

  registerDefinition(def: PipelineDefinition): void {
    this.definitions.set(def.id, def);
    this.executor.registerDefinition(def);

    if (def.trigger) {
      const key = `${def.trigger.repository}:${def.trigger.branch}`;
      this.repoIndex.set(key, def.id);
      this.concurrencyPolicy.set(def.id, def.trigger.allowParallelRuns);
    }
  }

  async onCommit(repo: string, branch: string, commitRef: string): Promise<void> {
    const key = `${repo}:${branch}`;
    const defId = this.repoIndex.get(key);
    if (!defId) return;

    const allowParallel = this.concurrencyPolicy.get(defId) ?? false;
    if (!allowParallel && this.executor.isRunning(defId)) {
      return; // silently skip if concurrent runs not allowed
    }

    await this.executor.execute(defId, commitRef);
  }

  async manualTrigger(
    definitionId: string,
    commitRef?: string
  ): Promise<Result<PipelineRun, TriggerError>> {
    const def = this.definitions.get(definitionId);
    if (!def) {
      return err({ type: "DefinitionNotFound", definitionId });
    }

    const allowParallel = this.concurrencyPolicy.get(definitionId) ?? false;
    if (!allowParallel && this.executor.isRunning(definitionId)) {
      return err({ type: "ConcurrentRun", definitionId });
    }

    const ref = commitRef ?? `latest-${def.trigger?.branch ?? "main"}`;
    const result = await this.executor.execute(definitionId, ref);

    if (!result.ok) {
      // Pipeline failed but run was created — return the run from executor
      const runs = this.executor.getLogger().getDefinitionHistory(definitionId);
      if (runs.length > 0) {
        const latestRun = this.executor.getStatus(runs[0].runId);
        if (latestRun) return ok(latestRun);
      }
      return err({ type: "DefinitionNotFound", definitionId });
    }

    return ok(result.value);
  }

  setConcurrencyPolicy(definitionId: string, allowParallel: boolean): void {
    this.concurrencyPolicy.set(definitionId, allowParallel);
  }
}
