// ─── Build_System Models ───

export interface PackageManifest {
  name: string;
  version: string;
  dependencies: DependencyRef[];
  buildSteps: BuildStep[];
  metadata?: Record<string, string>;
}

export interface DependencyRef {
  packageName: string;
  versionConstraint?: string;
}

export interface Package {
  id: string;
  name: string;
  version: string;
  dependencies: DependencyRef[];
  buildSteps: BuildStep[];
  registeredAt: Date;
}

export interface BuildStep {
  name: string;
  command: string;
  order: number;
}

export interface DependencyGraph {
  root: string;
  nodes: Map<string, DependencyNode>;
}

export interface DependencyNode {
  packageId: string;
  version: string;
  dependencies: string[];
}

export interface BuildArtifact {
  packageName: string;
  version: string;
  data: Uint8Array;
}

export interface ArtifactMetadata {
  buildTimestamp: Date;
  sourceCommitHash: string;
}

export interface StoredArtifact {
  artifact: BuildArtifact;
  metadata: ArtifactMetadata;
  publishedAt: Date;
}

export interface VersionSetSpec {
  name: string;
  versions: Map<string, string>;
}

export interface VersionSet {
  id: string;
  name: string;
  versions: Map<string, string>;
  createdAt: Date;
  frozen: true;
}
