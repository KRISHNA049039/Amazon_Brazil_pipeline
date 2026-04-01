import { Result, ok, err } from "../shared/result.js";
import { PackageManifest, Package } from "../shared/types.js";
import { RegistrationError } from "../shared/errors.js";

let nextId = 1;

export class PackageRegistry {
  private packagesById = new Map<string, Package>();
  private packagesByName = new Map<string, Package>();

  register(manifest: PackageManifest): Result<Package, RegistrationError> {
    // Validate required fields
    const missingFields: string[] = [];
    if (!manifest.name) missingFields.push("name");
    if (!manifest.version) missingFields.push("version");
    if (!manifest.buildSteps || manifest.buildSteps.length === 0) missingFields.push("buildSteps");

    if (missingFields.length > 0) {
      return err({ type: "InvalidManifest", missingFields });
    }

    // Check duplicate name
    if (this.packagesByName.has(manifest.name)) {
      return err({ type: "DuplicateName", name: manifest.name });
    }

    // Validate dependencies exist
    const unresolved: string[] = [];
    for (const dep of manifest.dependencies) {
      if (!this.packagesByName.has(dep.packageName)) {
        unresolved.push(dep.packageName);
      }
    }
    if (unresolved.length > 0) {
      return err({ type: "UnresolvedDeps", unresolvedDependencies: unresolved });
    }

    const id = `pkg-${nextId++}`;
    const pkg: Package = {
      id,
      name: manifest.name,
      version: manifest.version,
      dependencies: [...manifest.dependencies],
      buildSteps: [...manifest.buildSteps],
      registeredAt: new Date(),
    };

    this.packagesById.set(id, pkg);
    this.packagesByName.set(pkg.name, pkg);
    return ok(pkg);
  }

  get(packageId: string): Package | undefined {
    return this.packagesById.get(packageId);
  }

  getByName(name: string): Package | undefined {
    return this.packagesByName.get(name);
  }

  list(): Package[] {
    return Array.from(this.packagesById.values());
  }

  /** Reset ID counter — for testing only */
  static resetIdCounter(): void {
    nextId = 1;
  }
}
