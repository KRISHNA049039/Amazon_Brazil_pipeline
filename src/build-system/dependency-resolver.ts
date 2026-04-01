import { Result, ok, err } from "../shared/result.js";
import { DependencyGraph, DependencyNode, VersionSet } from "../shared/types.js";
import { ResolutionError } from "../shared/errors.js";
import { PackageRegistry } from "./package-registry.js";

export class DependencyResolver {
  constructor(private registry: PackageRegistry) {}

  resolve(packageId: string, versionSet?: VersionSet): Result<DependencyGraph, ResolutionError> {
    const rootPkg = this.registry.get(packageId);
    if (!rootPkg) {
      return err({ type: "PackageNotFound", packageId });
    }

    const nodes = new Map<string, DependencyNode>();
    const visiting = new Set<string>(); // for cycle detection
    const visited = new Set<string>();

    const visit = (pkgId: string, path: string[]): ResolutionError | null => {
      if (visiting.has(pkgId)) {
        const cycleStart = path.indexOf(pkgId);
        const cyclePath = [...path.slice(cycleStart), pkgId];
        return { type: "CycleDetected", cyclePath };
      }
      if (visited.has(pkgId)) return null;

      const pkg = this.registry.get(pkgId);
      if (!pkg) {
        return { type: "MissingDependency", missingDependencies: [pkgId] };
      }

      visiting.add(pkgId);
      path.push(pkgId);

      const depIds: string[] = [];
      for (const dep of pkg.dependencies) {
        const depPkg = this.registry.getByName(dep.packageName);
        if (!depPkg) {
          return { type: "MissingDependency", missingDependencies: [dep.packageName] };
        }
        depIds.push(depPkg.id);

        const error = visit(depPkg.id, [...path]);
        if (error) return error;
      }

      const version = versionSet?.versions.get(pkg.name) ?? pkg.version;

      nodes.set(pkgId, {
        packageId: pkgId,
        version,
        dependencies: depIds,
      });

      visiting.delete(pkgId);
      visited.add(pkgId);
      return null;
    };

    const error = visit(packageId, []);
    if (error) return err(error);

    return ok({ root: packageId, nodes });
  }
}
