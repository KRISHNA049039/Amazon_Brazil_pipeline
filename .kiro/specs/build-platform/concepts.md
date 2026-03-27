# Build Platform — Core Concepts

This document describes the architectural patterns and software engineering concepts that underpin the build platform. These are well-established industry patterns used in large-scale build and deployment systems.

---

## Build System Concepts

### Hermetic Builds

A hermetic build is one that depends only on its declared inputs — source code, dependencies, and build configuration. It does not reach out to the network, read undeclared files, or depend on the host environment. Hermeticity is the foundation of reproducibility: the same inputs always produce the same output.

Our Build_System enforces hermeticity by:
- Requiring all dependencies to be declared in the Package_Manifest
- Resolving the full transitive dependency graph before compilation
- Isolating concurrent builds so they cannot share mutable state

### Package-Oriented Architecture

Instead of a single monolithic build, the codebase is organized into discrete packages. Each package is a self-contained unit with:
- A declared name and version
- Explicit dependency declarations (no implicit or transitive assumptions at the package level)
- One or more build steps that transform source into artifacts

This mirrors the concept of a "workspace" or "module" in tools like Bazel, Buck, or Gradle multi-project builds — but with a centralized registry that enforces uniqueness and validates dependencies at registration time.

### Dependency Graph Resolution

Dependencies between packages form a Directed Acyclic Graph (DAG). The resolver:
1. Starts from the target package
2. Recursively collects all transitive dependencies
3. Detects cycles (which would make the graph invalid)
4. Pins versions using the active Version Set

Determinism is key — the same package + version set must always produce the same dependency graph. This eliminates "works on my machine" problems.

### Version Sets

A version set is a curated, immutable snapshot of compatible package versions. Think of it as a "known-good configuration" — a set of package versions that have been validated to work together.

Key properties:
- Immutable after creation (no silent version bumps)
- All referenced versions must exist in the artifact repository
- Builds resolve dependencies against a specific version set, not "latest"

This pattern is common in large organizations where hundreds of packages evolve independently. Without version sets, a single bad version of a shared library can break every downstream consumer.

### Build Caching / Incremental Builds

If nothing has changed (no source modifications, no dependency updates), there's no reason to rebuild. The build system detects this and returns the previously built artifact. This dramatically reduces build times in large dependency graphs where most packages haven't changed.

### Artifact Repository

Build outputs (binaries, container images, archives) are stored in a versioned artifact repository with metadata:
- Package name and version
- Build timestamp
- Source commit hash

This serves as the single source of truth for "what was built" and is consumed by both downstream builds and the deployment system.

---

## Deployment System Concepts

### Declarative Deployment Plans

Rather than imperative scripts ("ssh into box, copy file, restart service"), deployments are described declaratively:
- Which artifacts to deploy
- Which targets (environments) to deploy to
- In what order

The deployment system validates the plan before execution — checking that all artifacts exist and all targets are reachable. This catches errors before anything is deployed.

### Ordered Rollout with Halt-on-Failure

Deployments to multiple targets happen in a defined order (e.g., staging before production). If any target fails, the system halts — it doesn't blindly continue pushing a broken artifact to remaining targets.

This pattern is sometimes called "progressive delivery" or "staged rollout."

### Rollback

Every deployment is recorded in a per-target history. Rolling back means redeploying the previously known-good artifact version. The rollback itself is recorded as a new history entry, maintaining a complete audit trail.

The system retains at least 10 deployment records per target, so operators can roll back multiple levels if needed.

### Deployment Targets as First-Class Entities

Environments (staging, production, canary, etc.) are registered as named deployment targets with health/reachability checks. This prevents deploying to an environment that doesn't exist or is unreachable.

---

## Pipeline / CI-CD Concepts

### Declarative Pipeline Definitions

Pipelines are defined as configuration, not code. A pipeline definition specifies:
- An ordered sequence of stages
- Steps within each stage (build, test, deploy, or custom scripts)
- Which steps can run in parallel
- Trigger configuration (which repo/branch to watch)

The parser validates definitions and rejects unknown action types or syntax errors. The round-trip property (`parse → print → parse` produces the same result) ensures the definition format is lossless.

### Stages and Steps

- A **stage** is a logical phase (e.g., "Build", "Test", "Deploy to Staging", "Deploy to Prod")
- A **step** is an atomic unit of work within a stage
- Stages execute sequentially — stage N must complete before stage N+1 starts
- Steps within a stage can be marked as parallel for concurrent execution

### Halt-on-Failure Semantics

If any step fails, the entire pipeline run halts. Subsequent stages are not executed. This prevents deploying untested code or continuing a workflow after a critical failure.

### Automatic Triggering

Pipelines can be configured to trigger automatically when a commit is pushed to a monitored branch. This is the foundation of continuous integration — every code change goes through the full build/test/deploy pipeline without manual intervention.

### Concurrency Control

By default, only one pipeline run is active per definition at a time. This prevents race conditions where two concurrent runs deploy different versions. Operators can explicitly enable parallel runs when appropriate (e.g., for independent feature branches).

### Pipeline Runs as Immutable Records

Each execution creates a Pipeline_Run — an immutable record of what happened:
- Which commit triggered it
- Status of every stage and step (pending, running, succeeded, failed, skipped)
- Timestamps for start and completion
- Structured logs

This provides full observability and auditability.

---

## Cross-Cutting Concepts

### Observability and Audit Trail

Every action across all three subsystems is logged with structured data:
- Builds: start/end time, status, output per step
- Deployments: artifact version, operator identity, timestamp, outcome
- Pipelines: status and duration per stage and step

History queries return results in reverse chronological order (newest first).

### Result Type Error Handling

The platform uses a `Result<T, E>` pattern instead of thrown exceptions for expected failure paths. This makes error handling explicit in the type system — callers must handle both success and failure cases. Unexpected infrastructure failures propagate as exceptions and are caught at subsystem boundaries.

### Pluggable Storage

All persistence is behind interfaces. The initial implementation uses in-memory stores for fast iteration. The storage layer can be swapped to a database (PostgreSQL, DynamoDB, etc.) without changing business logic.
