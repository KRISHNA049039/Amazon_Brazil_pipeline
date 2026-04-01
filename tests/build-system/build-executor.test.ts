import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { PackageRegistry } from "../../src/build-system/package-registry.js";
import { DependencyResolver } from "../../src/build-system/dependency-resolver.js";
import { ArtifactRepository } from "../../src/build-system/artifact-repository.js";
import { VersionSetManager } from "../../src/build-system/version-set-manager.js";
import { BuildExecutor, BuildStepExecutor } from "../../src/build-system/build-executor.js";
import { BuildLogger } from "../../src/build-system/build-logger.js";
import { PackageManifest, BuildStep } from "../../src/shared/types.js";
import { ok, err, Result } from "../../src/shared/result.js";

function manifest(name: string, steps: BuildStep[], deps: string[] = []): PackageManifest {
  return {
    name,
    version: "1.0.0",
    dependencies: deps.map((d) => ({ packageName: d })),
    buildSteps: steps,
  };
}

class TrackingExecutor implements BuildStepExecutor {
  executedCommands: string[] = [];
  failOnCommand?: string;

  async execute(command: string): Promise<Result<string, string>> {
    this.executedCommands.push(command);
    if (this.failOnCommand && command === this.failOnCommand) {
      return err(`Command failed: ${command}`);
    }
    return ok("success");
  }
}

describe("BuildExecutor", () => {
  let registry: PackageRegistry;
  let resolver: DependencyResolver;
  let artifactRepo: ArtifactRepository;
  let vsManager: VersionSetManager;
  let tracker: TrackingExecutor;
  let logger: BuildLogger;
  let executor: BuildExecutor;

  beforeEach(() => {
    registry = new PackageRegistry();
    resolver = new DependencyResolver(registry);
    artifactRepo = new ArtifactRepository();
    vsManager = new VersionSetManager(artifactRepo);
    tracker = new TrackingExecutor();
    logger = new BuildLogger();
    executor = new BuildExecutor(registry, resolver, artifactRepo, vsManager, tracker, logger);
    PackageRegistry.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("builds a single-step package", async () => {
    const r = registry.register(manifest("simple", [{ name: "compile", command: "tsc", order: 1 }]));
    if (!r.ok) throw new Error("reg failed");
    const result = await executor.build(r.value.id);
    expect(result.ok).toBe(true);
    expect(tracker.executedCommands).toEqual(["tsc"]);
  });

  it("halts on step failure", async () => {
    tracker.failOnCommand = "test";
    const r = registry.register(
      manifest("fail-pkg", [
        { name: "compile", command: "tsc", order: 1 },
        { name: "test", command: "test", order: 2 },
        { name: "package", command: "pkg", order: 3 },
      ])
    );
    if (!r.ok) throw new Error("reg failed");
    const result = await executor.build(r.value.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("StepFailed");
      if (result.error.type === "StepFailed") {
        expect(result.error.stepName).toBe("test");
      }
    }
    // "pkg" should not have been executed
    expect(tracker.executedCommands).toEqual(["tsc", "test"]);
  });

  it("returns cached artifact on second build", async () => {
    const r = registry.register(manifest("cached", [{ name: "build", command: "build", order: 1 }]));
    if (!r.ok) throw new Error("reg failed");

    await executor.build(r.value.id);
    tracker.executedCommands = [];

    const result = await executor.build(r.value.id);
    expect(result.ok).toBe(true);
    expect(tracker.executedCommands).toEqual([]); // no re-execution
  });

  it("returns error for nonexistent package", async () => {
    const result = await executor.build("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("PackageNotFound");
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 7: Build step execution order
  it("Property 7: build steps execute in declared order", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        async (numSteps) => {
          const reg = new PackageRegistry();
          const res = new DependencyResolver(reg);
          const ar = new ArtifactRepository();
          const vsm = new VersionSetManager(ar);
          const track = new TrackingExecutor();
          const bl = new BuildLogger();
          const exec = new BuildExecutor(reg, res, ar, vsm, track, bl);

          const steps: BuildStep[] = [];
          for (let i = 0; i < numSteps; i++) {
            steps.push({ name: `step-${i}`, command: `cmd-${i}`, order: i + 1 });
          }

          const r = reg.register(manifest(`ordered-${numSteps}`, steps));
          if (!r.ok) return;

          await exec.build(r.value.id);

          for (let i = 0; i < numSteps; i++) {
            expect(track.executedCommands[i]).toBe(`cmd-${i}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 8: Build halts on step failure
  it("Property 8: build halts on step failure", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        async (numSteps, failIdx) => {
          const actualFailIdx = Math.min(failIdx, numSteps - 1);
          const reg = new PackageRegistry();
          const res = new DependencyResolver(reg);
          const ar = new ArtifactRepository();
          const vsm = new VersionSetManager(ar);
          const track = new TrackingExecutor();
          const bl = new BuildLogger();
          const exec = new BuildExecutor(reg, res, ar, vsm, track, bl);

          const steps: BuildStep[] = [];
          for (let i = 0; i < numSteps; i++) {
            steps.push({ name: `step-${i}`, command: `cmd-${i}`, order: i + 1 });
          }
          track.failOnCommand = `cmd-${actualFailIdx}`;

          const r = reg.register(manifest(`halt-${numSteps}-${actualFailIdx}`, steps));
          if (!r.ok) return;

          const result = await exec.build(r.value.id);
          expect(result.ok).toBe(false);
          if (!result.ok && result.error.type === "StepFailed") {
            expect(result.error.stepName).toBe(`step-${actualFailIdx}`);
          }
          // Steps after failure should not execute
          expect(track.executedCommands.length).toBe(actualFailIdx + 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 9: Build caching idempotence
  it("Property 9: build caching idempotence", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (numSteps) => {
          const reg = new PackageRegistry();
          const res = new DependencyResolver(reg);
          const ar = new ArtifactRepository();
          const vsm = new VersionSetManager(ar);
          const track = new TrackingExecutor();
          const bl = new BuildLogger();
          const exec = new BuildExecutor(reg, res, ar, vsm, track, bl);

          const steps: BuildStep[] = [];
          for (let i = 0; i < numSteps; i++) {
            steps.push({ name: `s${i}`, command: `c${i}`, order: i + 1 });
          }

          const r = reg.register(manifest(`cache-${numSteps}-${Math.random()}`, steps));
          if (!r.ok) return;

          const first = await exec.build(r.value.id);
          expect(first.ok).toBe(true);

          track.executedCommands = [];
          const second = await exec.build(r.value.id);
          expect(second.ok).toBe(true);
          expect(track.executedCommands.length).toBe(0); // cached, no re-execution

          if (first.ok && second.ok) {
            expect(first.value.packageName).toBe(second.value.packageName);
            expect(first.value.version).toBe(second.value.version);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
