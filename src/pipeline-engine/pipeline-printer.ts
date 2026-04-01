import { PipelineDefinition } from "../shared/pipeline-types.js";

export class PipelinePrinter {
  print(definition: PipelineDefinition): string {
    const obj: any = {
      id: definition.id,
      name: definition.name,
      stages: definition.stages.map((stage) => {
        const s: any = {
          name: stage.name,
          steps: stage.steps.map((step) => {
            const st: any = {
              name: step.name,
              action: step.action,
            };
            if (step.script !== undefined) st.script = step.script;
            if (step.parallel) st.parallel = true;
            if (step.approvalMessage !== undefined) st.approvalMessage = step.approvalMessage;
            return st;
          }),
        };
        if (stage.inputArtifacts && stage.inputArtifacts.length > 0) {
          s.inputArtifacts = stage.inputArtifacts;
        }
        if (stage.outputArtifacts && stage.outputArtifacts.length > 0) {
          s.outputArtifacts = stage.outputArtifacts;
        }
        return s;
      }),
    };

    if (definition.trigger) {
      obj.trigger = {
        repository: definition.trigger.repository,
        branch: definition.trigger.branch,
        allowParallelRuns: definition.trigger.allowParallelRuns,
      };
    }

    return JSON.stringify(obj, null, 2);
  }
}
