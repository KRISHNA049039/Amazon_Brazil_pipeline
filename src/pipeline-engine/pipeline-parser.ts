import { Result, ok, err } from "../shared/result.js";
import { PipelineDefinition, StageDefinition, StepDefinition, ActionType, TriggerConfig, StageArtifact } from "../shared/pipeline-types.js";
import { ParseError } from "../shared/errors.js";

const VALID_ACTIONS: ActionType[] = ["build", "test", "deploy", "custom", "approval"];

let nextDefId = 1;

export class PipelineParser {
  parse(input: string): Result<PipelineDefinition, ParseError> {
    let parsed: any;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      return err({ type: "SyntaxError", location: "root", description: "Invalid JSON" });
    }

    if (!parsed.name || typeof parsed.name !== "string") {
      return err({ type: "SyntaxError", location: "name", description: "Missing or invalid pipeline name" });
    }

    if (!Array.isArray(parsed.stages) || parsed.stages.length === 0) {
      return err({ type: "SyntaxError", location: "stages", description: "Missing or empty stages array" });
    }

    const stages: StageDefinition[] = [];
    for (let i = 0; i < parsed.stages.length; i++) {
      const s = parsed.stages[i];
      if (!s.name || typeof s.name !== "string") {
        return err({ type: "SyntaxError", location: `stages[${i}].name`, description: "Missing stage name" });
      }
      if (!Array.isArray(s.steps) || s.steps.length === 0) {
        return err({ type: "SyntaxError", location: `stages[${i}].steps`, description: "Missing or empty steps" });
      }

      const steps: StepDefinition[] = [];
      for (let j = 0; j < s.steps.length; j++) {
        const step = s.steps[j];
        if (!step.name || typeof step.name !== "string") {
          return err({ type: "SyntaxError", location: `stages[${i}].steps[${j}].name`, description: "Missing step name" });
        }
        if (!VALID_ACTIONS.includes(step.action)) {
          return err({ type: "UnknownAction", actionType: step.action ?? "undefined" });
        }
        steps.push({
          name: step.name,
          action: step.action as ActionType,
          script: step.script,
          parallel: step.parallel ?? false,
          approvalMessage: step.approvalMessage,
        });
      }

      const inputArtifacts: StageArtifact[] | undefined = Array.isArray(s.inputArtifacts)
        ? s.inputArtifacts.map((a: any) => ({ name: a.name, packageName: a.packageName, version: a.version }))
        : undefined;
      const outputArtifacts: StageArtifact[] | undefined = Array.isArray(s.outputArtifacts)
        ? s.outputArtifacts.map((a: any) => ({ name: a.name, packageName: a.packageName, version: a.version }))
        : undefined;

      stages.push({ name: s.name, steps, inputArtifacts, outputArtifacts });
    }

    let trigger: TriggerConfig | undefined;
    if (parsed.trigger) {
      trigger = {
        repository: parsed.trigger.repository ?? "",
        branch: parsed.trigger.branch ?? "main",
        allowParallelRuns: parsed.trigger.allowParallelRuns ?? false,
      };
    }

    const id = parsed.id ?? `pipeline-${nextDefId++}`;

    return ok({ id, name: parsed.name, stages, trigger });
  }

  static resetIdCounter(): void {
    nextDefId = 1;
  }
}
