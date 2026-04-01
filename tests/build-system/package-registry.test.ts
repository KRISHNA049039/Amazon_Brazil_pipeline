import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { PackageRegistry } from "../../src/build-system/package-registry.js";
import { PackageManifest } from "../../src/shared/types.js";

function validManifest(name: string, version = "1.0.0", deps: string[] = []): PackageManifest {
  return {
    name,
    version,
    dependencies: deps.map((d) => ({ packageName: d })),
    buildSteps: [{ name: "compile", command: "tsc", order: 1 }],
  };
}

const arbName = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0 && !s.includes("\0"));
const arbVersion = fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map(([a, b, c]) => `${a}.${b}.${c}`);

describe("PackageRegistry", () => {
  let registry: PackageRegistry;

  beforeEach(() => {
    registry = new PackageRegistry();
    PackageRegistry.resetIdCounter();
  });

  // ─── Unit Tests ───

  it("registers a valid package", () => {
    const result = registry.register(validManifest("my-pkg"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("my-pkg");
      expect(result.value.id).toBeTruthy();
    }
  });

  it("rejects duplicate name", () => {
    registry.register(validManifest("dup"));
    const result = registry.register(validManifest("dup"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("DuplicateName");
  });

  it("rejects missing name", () => {
    const result = registry.register({ name: "", version: "1.0.0", dependencies: [], buildSteps: [{ name: "b", command: "c", order: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("InvalidManifest");
  });

  it("rejects missing version", () => {
    const result = registry.register({ name: "x", version: "", dependencies: [], buildSteps: [{ name: "b", command: "c", order: 1 }] });
    expect(result.ok).toBe(false);
  });

  it("rejects empty build steps", () => {
    const result = registry.register({ name: "x", version: "1.0.0", dependencies: [], buildSteps: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("InvalidManifest");
  });

  it("rejects unresolved dependencies", () => {
    const result = registry.register(validManifest("x", "1.0.0", ["nonexistent"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe("UnresolvedDeps");
  });

  it("lists registered packages", () => {
    registry.register(validManifest("a"));
    registry.register(validManifest("b"));
    expect(registry.list().length).toBe(2);
  });

  it("gets by name", () => {
    registry.register(validManifest("findme"));
    expect(registry.getByName("findme")).toBeDefined();
    expect(registry.getByName("nope")).toBeUndefined();
  });

  // ─── Property Tests ───

  // Feature: build-platform, Property 1: Valid manifest registration produces unique IDs
  it("Property 1: valid manifests get unique IDs", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbName, { minLength: 2, maxLength: 20 }),
        arbVersion,
        (names, version) => {
          const reg = new PackageRegistry();
          const ids = new Set<string>();
          for (const name of names) {
            const result = reg.register(validManifest(name, version));
            if (result.ok) {
              expect(ids.has(result.value.id)).toBe(false);
              ids.add(result.value.id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 2: Duplicate package name rejection
  it("Property 2: duplicate names are rejected", () => {
    fc.assert(
      fc.property(arbName, arbVersion, (name, version) => {
        const reg = new PackageRegistry();
        const first = reg.register(validManifest(name, version));
        if (!first.ok) return; // skip if name is invalid
        const second = reg.register(validManifest(name, version));
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.error.type).toBe("DuplicateName");
      }),
      { numRuns: 100 }
    );
  });

  // Feature: build-platform, Property 3: Invalid manifest rejection
  it("Property 3: invalid manifests are rejected", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.oneof(fc.constant(""), fc.constant(undefined as any)),
          version: fc.oneof(fc.constant(""), arbVersion),
          buildSteps: fc.oneof(fc.constant([]), fc.constant([{ name: "b", command: "c", order: 1 }])),
        }),
        (manifest) => {
          const reg = new PackageRegistry();
          // At least one field is invalid
          const m: PackageManifest = {
            name: manifest.name ?? "",
            version: manifest.version ?? "",
            dependencies: [],
            buildSteps: manifest.buildSteps,
          };
          if (!m.name || !m.version || m.buildSteps.length === 0) {
            const result = reg.register(m);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.type).toBe("InvalidManifest");
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
