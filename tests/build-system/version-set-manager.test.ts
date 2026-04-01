import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { ArtifactRepository } from "../../src/build-system/artifact-repository.js";
import { VersionSetManager } from "../../src/build-system/version-set-manager.js";

describe("VersionSetManager", () => {
  let artifactRepo: ArtifactRepository;
  let vsManager: VersionSetManager;

  beforeEach(() => {
    artifactRepo = new ArtifactRepository();
    vsManager = new VersionSetManager(artifactRepo);
    VersionSetManager.resetIdCounter();
  });

  function publishArtifact(name: string, version: string) {
    artifactRepo.publish(
      { packageName: name, version, data: new Uint8Array([1]) },
      { buildTimestamp: new Date(), sourceCommitHash: "abc" }
    );
  }

  // ─── Unit Tests ───

  it("creates a version set with valid references", () => {
    publishArtifact("pkg-a", "1.0.0");
    const result = vsManager.create({ name: "vs1", versions: new Map([["pkg-a", "1.0.0"]]) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.frozen).toBe(true);
      expect(result.value.versions.get("pkg-a")).toBe("1.0.0");
    }
  });

  it("rejects version set with missing artifacts", () => {
    const result = vsManager.create({ name: "vs-bad", versions: new Map([["missing", "1.0.0"]]) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("MissingVersions");
  });

  it("validates existing version set after artifact deletion", () => {
    publishArtifact("pkg-x", "1.0.0");
    const vs = vsManager.create({ name: "vs-del", versions: new Map([["pkg-x", "1.0.0"]]) });
    expect(vs.ok).toBe(true);
    if (!vs.ok) return;

    artifactRepo.delete("pkg-x", "1.0.0");
    const validation = vsManager.validate(vs.value.id);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.error.type).toBe("MissingVersions");
  });

  it("single package version set", () => {
    publishArtifact("solo", "0.1.0");
    const result = vsManager.create({ name: "solo-vs", versions: new Map([["solo", "0.1.0"]]) });
    expect(result.ok).toBe(true);
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 10: Version set immutability
  it("Property 10: version set immutability", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
        (names) => {
          const ar = new ArtifactRepository();
          const vsm = new VersionSetManager(ar);

          const versions = new Map<string, string>();
          for (const name of names) {
            ar.publish(
              { packageName: name, version: "1.0.0", data: new Uint8Array([1]) },
              { buildTimestamp: new Date(), sourceCommitHash: "abc" }
            );
            versions.set(name, "1.0.0");
          }

          const result = vsm.create({ name: `immut-${Math.random()}`, versions });
          if (!result.ok) return;

          const vs = result.value;
          // Read it back
          const retrieved = vsm.get(vs.id);
          expect(retrieved).toBeDefined();
          if (retrieved) {
            expect(retrieved.frozen).toBe(true);
            for (const [name, ver] of versions) {
              expect(retrieved.versions.get(name)).toBe(ver);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 12: Version set validation against artifact repository
  it("Property 12: version set validation against artifact repo", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        (names, allExist) => {
          const ar = new ArtifactRepository();
          const vsm = new VersionSetManager(ar);

          const versions = new Map<string, string>();
          for (const name of names) {
            if (allExist) {
              ar.publish(
                { packageName: name, version: "1.0.0", data: new Uint8Array([1]) },
                { buildTimestamp: new Date(), sourceCommitHash: "abc" }
              );
            }
            versions.set(name, "1.0.0");
          }

          const result = vsm.create({ name: `val-${Math.random()}`, versions });
          if (allExist) {
            expect(result.ok).toBe(true);
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.type).toBe("MissingVersions");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
