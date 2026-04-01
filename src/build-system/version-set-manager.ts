import { Result, ok, err } from "../shared/result.js";
import { VersionSet, VersionSetSpec } from "../shared/types.js";
import { VersionSetError } from "../shared/errors.js";
import { ArtifactRepository } from "./artifact-repository.js";

let nextVsId = 1;

export class VersionSetManager {
  private store = new Map<string, VersionSet>();
  private nameIndex = new Map<string, string>();

  constructor(private artifactRepo: ArtifactRepository) {}

  create(spec: VersionSetSpec): Result<VersionSet, VersionSetError> {
    if (this.nameIndex.has(spec.name)) {
      return err({ type: "DuplicateName", name: spec.name });
    }

    // Validate all versions exist in artifact repo
    const missing: Array<{ packageName: string; version: string }> = [];
    for (const [packageName, version] of spec.versions) {
      if (!this.artifactRepo.exists(packageName, version)) {
        missing.push({ packageName, version });
      }
    }
    if (missing.length > 0) {
      return err({ type: "MissingVersions", missing });
    }

    const id = `vs-${nextVsId++}`;
    const vs: VersionSet = {
      id,
      name: spec.name,
      versions: new Map(spec.versions),
      createdAt: new Date(),
      frozen: true,
    };

    this.store.set(id, vs);
    this.nameIndex.set(spec.name, id);
    return ok(vs);
  }

  get(versionSetId: string): VersionSet | undefined {
    return this.store.get(versionSetId);
  }

  validate(versionSetId: string): Result<void, VersionSetError> {
    const vs = this.store.get(versionSetId);
    if (!vs) return ok(undefined);

    const missing: Array<{ packageName: string; version: string }> = [];
    for (const [packageName, version] of vs.versions) {
      if (!this.artifactRepo.exists(packageName, version)) {
        missing.push({ packageName, version });
      }
    }
    if (missing.length > 0) {
      return err({ type: "MissingVersions", missing });
    }
    return ok(undefined);
  }

  static resetIdCounter(): void {
    nextVsId = 1;
  }
}
