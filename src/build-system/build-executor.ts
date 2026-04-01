import { Result, ok, err } from "../shared/result.js";
import { BuildArtifact, VersionSet } from "../shared/types.js";
import { BuildError } from "../shared/errors.js";
import { PackageRegistry } from "./package-registry.js";
import { DependencyResolver } from "./dependency-resolver.js";
import { ArtifactRepository } from "./artifact-repository.js";
import { VersionSetManager } from "./version-set-manager.js";
import { BuildLogger } from "./build-logger.js";

export interface BuildStepExecutor {
  execute(command: string): Promise<Result<string, string>>;
}

export class DefaultBuildStepExecutor implements BuildStepExecutor {
  async execute(_command: string): Promise<Result<string, string>> {
    return ok("ok");
  }
}

export class BuildExecutor {
  private buildCache = new Map<string, BuildArtifact>();
  private sourceHashes = new Map<string, string>();

  constructor(
    private registry: PackageRegistry,
    private resolver: DependencyResolver,
    private artifactRepo: ArtifactRepository,
    private versionSetManager: VersionSetManager,
    private stepExecutor: BuildStepExecutor = new DefaultBuildStepExecutor(),
    private logger: BuildLogger = new BuildLogger()
  ) {}

  async build(packageId: string, versionSet?: VersionSet): Promise<Result<BuildArtifact, BuildError>> {
    const pkg = this.registry.get(packageId);
    if (!pkg) {
      return err({ type: "PackageNotFound", packageId });
    }

    // Validate version set if provided
    if (versionSet) {
      const validation = this.versionSetManager.validate(versionSet.id);
      if (!validation.ok) {
        return err({ type: "ResolutionFailed", error: { type: "MissingDependency", missingDependencies: [] } });
      }
    }

    // Resolve dependencies
    const resolution = this.resolver.resolve(packageId, versionSet);
    if (!resolution.ok) {
      return err({ type: "ResolutionFailed", error: resolution.error });
    }

    // Check cache
    const cacheKey = this.getCacheKey(packageId, versionSet);
    const currentHash = this.computeSourceHash(packageId);
    const previousHash = this.sourceHashes.get(cacheKey);

    if (previousHash === currentHash && this.buildCache.has(cacheKey)) {
      return ok(this.buildCache.get(cacheKey)!);
    }

    // Execute build steps in order
    const sortedSteps = [...pkg.buildSteps].sort((a, b) => a.order - b.order);
    const buildStart = new Date();
    const stepOutputs: Array<{ stepName: string; output: string; status: string }> = [];

    for (const step of sortedSteps) {
      const stepStart = new Date();
      const result = await this.stepExecutor.execute(step.command);
      const stepEnd = new Date();

      if (!result.ok) {
        stepOutputs.push({ stepName: step.name, output: result.error, status: "failed" });
        this.logger.logBuild(packageId, buildStart, new Date(), "failed", stepOutputs);
        return err({ type: "StepFailed", stepName: step.name, reason: result.error });
      }
      stepOutputs.push({ stepName: step.name, output: result.value, status: "succeeded" });
    }

    // Create artifact
    const artifact: BuildArtifact = {
      packageName: pkg.name,
      version: pkg.version,
      data: new Uint8Array([1, 2, 3]), // simulated build output
    };

    // Publish to artifact repo
    this.artifactRepo.publish(artifact, {
      buildTimestamp: new Date(),
      sourceCommitHash: currentHash,
    });

    // Cache
    this.buildCache.set(cacheKey, artifact);
    this.sourceHashes.set(cacheKey, currentHash);

    const buildEnd = new Date();
    this.logger.logBuild(packageId, buildStart, buildEnd, "succeeded", stepOutputs);

    return ok(artifact);
  }

  /** Simulate source change to invalidate cache */
  invalidateCache(packageId: string): void {
    for (const [key] of this.buildCache) {
      if (key.startsWith(packageId)) {
        this.buildCache.delete(key);
        this.sourceHashes.delete(key);
      }
    }
  }

  getLogger(): BuildLogger {
    return this.logger;
  }

  private getCacheKey(packageId: string, versionSet?: VersionSet): string {
    return versionSet ? `${packageId}:${versionSet.id}` : packageId;
  }

  private computeSourceHash(packageId: string): string {
    // In a real system, this would hash source files. For now, return a stable hash.
    return `hash-${packageId}`;
  }
}
