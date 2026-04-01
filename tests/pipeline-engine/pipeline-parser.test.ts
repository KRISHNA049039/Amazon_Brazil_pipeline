import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { PipelineParser } from "../../src/pipeline-engine/pipeline-parser.js";
import { PipelinePrinter } from "../../src/pipeline-engine/pipeline-printer.js";
import { ActionType, PipelineDefinition, StageDefinition, StepDefinition } from "../../src/shared/pipeline-types.js";

const VALID_ACTIONS: ActionType[] = ["build", "test", "deploy", "custom", "approval"];

const arbAction = fc.constantFrom(...VALID_ACTIONS);
const arbStep = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  action: arbAction,
  parallel: fc.boolean(),
});
const arbStage = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  steps: fc.array(arbStep, { minLength: 1, maxLength: 5 }),
});
const arbPipelineDef = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  stages: fc.array(arbStage, { minLength: 1, maxLength: 5 }),
});

describe("PipelineParser & PipelinePrinter", () => {
  let parser: PipelineParser;
  let printer: PipelinePrinter;

  beforeEach(() => {
    parser = new PipelineParser();
    printer = new PipelinePrinter();
    PipelineParser.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("parses a valid pipeline definition", () => {
    const input = JSON.stringify({
      name: "CI Pipeline",
      stages: [
        {
          name: "Build",
          steps: [{ name: "compile", action: "build" }],
        },
      ],
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("CI Pipeline");
      expect(result.value.stages.length).toBe(1);
    }
  });

  it("rejects invalid JSON", () => {
    const result = parser.parse("not json{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("SyntaxError");
  });

  it("rejects unknown action type", () => {
    const input = JSON.stringify({
      name: "Bad",
      stages: [{ name: "S1", steps: [{ name: "s", action: "explode" }] }],
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UnknownAction");
  });

  it("rejects missing pipeline name", () => {
    const input = JSON.stringify({
      stages: [{ name: "S1", steps: [{ name: "s", action: "build" }] }],
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(false);
  });

  it("rejects empty stages", () => {
    const input = JSON.stringify({ name: "Empty", stages: [] });
    const result = parser.parse(input);
    expect(result.ok).toBe(false);
  });

  it("rejects missing step name", () => {
    const input = JSON.stringify({
      name: "Bad",
      stages: [{ name: "S1", steps: [{ action: "build" }] }],
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(false);
  });

  it("parses pipeline with trigger config", () => {
    const input = JSON.stringify({
      name: "Triggered",
      stages: [{ name: "S1", steps: [{ name: "s", action: "build" }] }],
      trigger: { repository: "my-repo", branch: "main", allowParallelRuns: false },
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trigger?.repository).toBe("my-repo");
    }
  });

  it("single stage single step", () => {
    const input = JSON.stringify({
      name: "Minimal",
      stages: [{ name: "Only", steps: [{ name: "only-step", action: "test" }] }],
    });
    const result = parser.parse(input);
    expect(result.ok).toBe(true);
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 20: Pipeline definition round-trip
  it("Property 20: pipeline definition round-trip", () => {
    fc.assert(
      fc.property(arbPipelineDef, (defSpec) => {
        const def: PipelineDefinition = {
          id: defSpec.id,
          name: defSpec.name,
          stages: defSpec.stages.map((s) => ({
            name: s.name,
            steps: s.steps.map((st) => ({
              name: st.name,
              action: st.action,
              parallel: st.parallel || false,
            })),
          })),
        };

        const printed = printer.print(def);
        const parsed = parser.parse(printed);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        // Round-trip: parse(print(def)) should equal def
        expect(parsed.value.id).toBe(def.id);
        expect(parsed.value.name).toBe(def.name);
        expect(parsed.value.stages.length).toBe(def.stages.length);

        for (let i = 0; i < def.stages.length; i++) {
          expect(parsed.value.stages[i].name).toBe(def.stages[i].name);
          expect(parsed.value.stages[i].steps.length).toBe(def.stages[i].steps.length);
          for (let j = 0; j < def.stages[i].steps.length; j++) {
            expect(parsed.value.stages[i].steps[j].name).toBe(def.stages[i].steps[j].name);
            expect(parsed.value.stages[i].steps[j].action).toBe(def.stages[i].steps[j].action);
          }
        }

        // Double round-trip: parse(print(parse(print(def)))) === parse(print(def))
        const printed2 = printer.print(parsed.value);
        const parsed2 = parser.parse(printed2);
        expect(parsed2.ok).toBe(true);
        if (parsed2.ok) {
          expect(parsed2.value.name).toBe(parsed.value.name);
          expect(parsed2.value.stages.length).toBe(parsed.value.stages.length);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 21: Pipeline parser rejects invalid action types
  it("Property 21: parser rejects invalid action types", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => s.trim().length > 0 && !VALID_ACTIONS.includes(s as ActionType)
        ),
        (badAction) => {
          const input = JSON.stringify({
            name: "Bad",
            stages: [{ name: "S1", steps: [{ name: "s", action: badAction }] }],
          });
          const result = parser.parse(input);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.type).toBe("UnknownAction");
        }
      ),
      { numRuns: 100 }
    );
  });
});
