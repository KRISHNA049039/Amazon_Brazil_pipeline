import { Result, ok, err } from "../shared/result.js";
import { BuildArtifact, ArtifactMetadata, StoredArtifact } from "../shared/types.js";
import { ArtifactError } from "../shared/errors.js";

export class ArtifactRepository {
  private store = new Map<string, StoredArtifact>();

  private key(packageName: string, version: string): string {
    return `${packageName}@${version}`;
  }

  publish(artifact: BuildArtifact, metadata: ArtifactMetadata): Result<void, ArtifactError> {
    const k = this.key(artifact.packageName, artifact.version);
    this.store.set(k, {
      artifact,
      metadata,
      publishedAt: new Date(),
    });
    return ok(undefined);
  }

  get(packageName: string, version: string): Result<StoredArtifact, ArtifactError> {
    const stored = this.store.get(this.key(packageName, version));
    if (!stored) {
      return err({ type: "NotFound", packageName, version });
    }
    return ok(stored);
  }

  delete(packageName: string, version: string): Result<void, ArtifactError> {
    const k = this.key(packageName, version);
    if (!this.store.has(k)) {
      return err({ type: "NotFound", packageName, version });
    }
    this.store.delete(k);
    return ok(undefined);
  }

  exists(packageName: string, version: string): boolean {
    return this.store.has(this.key(packageName, version));
  }
}
