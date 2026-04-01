import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { ArtifactRepository } from "../../src/build-system/artifact-repository.js";

describe("ArtifactRepository", () => {
  let repo: ArtifactRepository;

  beforeEach(() => {
    repo = new ArtifactRepository();
  });

  // ─── Unit Tests ───

  it("publishes and retrieves an artifact", () => {
    const data = new Uint8Array([1, 2, 3]);
    repo.publish(
      { packageName: "pkg", version: "1.0.0", data },
      { buildTimestamp: new Date(), sourceCommitHash: "abc123" }
    );

    const result = repo.get("pkg", "1.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.artifact.packageName).toBe("pkg");
      expect(result.value.metadata.sourceCommitHash).toBe("abc123");
    }
  });

  it("returns error for missing artifact", () => {
    const result = repo.get("nope", "1.0.0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("NotFound");
      expect(result.error.packageName).toBe("nope");
    }
  });

  it("deletes an artifact", () => {
    repo.publish(
      { packageName: "del", version: "1.0.0", data: new Uint8Array([1]) },
      { buildTimestamp: new Date(), sourceCommitHash: "x" }
    );
    expect(repo.exists("del", "1.0.0")).toBe(true);
    repo.delete("del", "1.0.0");
    expect(repo.exists("del", "1.0.0")).toBe(false);
  });

  it("exists returns false for missing", () => {
    expect(repo.exists("x", "1.0.0")).toBe(false);
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 13: Artifact storage round-trip
  it("Property 13: artifact storage round-trip", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map(([a, b, c]) => `${a}.${b}.${c}`),
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        fc.hexaString({ minLength: 6, maxLength: 40 }),
        (name, version, data, commitHash) => {
          const ar = new ArtifactRepository();
          const timestamp = new Date();

          ar.publish(
            { packageName: name, version, data },
            { buildTimestamp: timestamp, sourceCommitHash: commitHash }
          );

          const result = ar.get(name, version);
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.artifact.packageName).toBe(name);
            expect(result.value.artifact.version).toBe(version);
            expect(result.value.artifact.data).toEqual(data);
            expect(result.value.metadata.sourceCommitHash).toBe(commitHash);
            expect(result.value.metadata.buildTimestamp).toEqual(timestamp);
          }

          // Should remain retrievable
          expect(ar.exists(name, version)).toBe(true);

          // After delete, should not exist
          ar.delete(name, version);
          expect(ar.exists(name, version)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
