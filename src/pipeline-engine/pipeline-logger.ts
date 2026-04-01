import { LogEntry, PipelineRunLog, PipelineRun } from "../shared/pipeline-types.js";

export class PipelineLogger {
  private logs = new Map<string, LogEntry[]>();
  private runMeta = new Map<string, { definitionId: string; run: PipelineRun }>();

  log(runId: string, entry: LogEntry): void {
    const entries = this.logs.get(runId) ?? [];
    entries.push(entry);
    this.logs.set(runId, entries);
  }

  setRunMeta(runId: string, definitionId: string, run: PipelineRun): void {
    this.runMeta.set(runId, { definitionId, run });
  }

  getRunLog(runId: string): PipelineRunLog | undefined {
    const entries = this.logs.get(runId);
    const meta = this.runMeta.get(runId);
    if (!entries || !meta) return undefined;

    const run = meta.run;
    const stageDurations = new Map<string, number>();
    const stepDurations = new Map<string, number>();

    for (const stage of run.stages) {
      if (stage.startedAt && stage.completedAt) {
        stageDurations.set(stage.stageName, stage.completedAt.getTime() - stage.startedAt.getTime());
      }
      for (const step of stage.steps) {
        if (step.startedAt && step.completedAt) {
          stepDurations.set(`${stage.stageName}.${step.stepName}`, step.completedAt.getTime() - step.startedAt.getTime());
        }
      }
    }

    return {
      runId,
      definitionId: meta.definitionId,
      entries,
      summary: {
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        stageDurations,
        stepDurations,
      },
    };
  }

  getDefinitionHistory(definitionId: string): PipelineRunLog[] {
    const results: PipelineRunLog[] = [];
    for (const [runId, meta] of this.runMeta) {
      if (meta.definitionId === definitionId) {
        const log = this.getRunLog(runId);
        if (log) results.push(log);
      }
    }
    // Reverse chronological
    return results.sort((a, b) => b.summary.startedAt.getTime() - a.summary.startedAt.getTime());
  }
}
