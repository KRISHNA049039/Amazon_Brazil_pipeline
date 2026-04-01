# Build Platform — Architecture & Code Flow Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Project Structure](#project-structure)
3. [Layered Architecture](#layered-architecture)
4. [Dependency Graph Between Components](#dependency-graph-between-components)
5. [Subsystem 1: Build System](#subsystem-1-build-system)
6. [Subsystem 2: Deployment System](#subsystem-2-deployment-system)
7. [Subsystem 3: Pipeline Engine](#subsystem-3-pipeline-engine)
8. [Cross-Cutting: Error Handling](#cross-cutting-error-handling)
9. [Cross-Cutting: Observability](#cross-cutting-observability)
10. [UI Dashboard](#ui-dashboard)
11. [Testing Architecture](#testing-architecture)
12. [Maintenance Guide](#maintenance-guide)

---

## System Overview

The platform is a TypeScript monorepo implementing three cooperating subsystems:

```
┌─────────────────────────────────────────────────────────────┐
│                      Pipeline Engine                        │
│  (Orchestrates end-to-end CI/CD workflows)                  │
│                                                             │
│  PipelineParser ─► PipelineExecutor ─► PipelineLogger       │
│  PipelinePrinter   PipelineTrigger     ApprovalProvider     │
├──────────────┬──────────────────────────┬───────────────────┤
│ Build System │                          │ Deployment System │
│              │    Artifact Repository   │                   │
│ PackageReg.  │◄────── (shared) ───────►│ DeployPlanCreator │
│ DepResolver  │                          │ DeployExecutor    │
│ BuildExec.   │                          │ RollbackManager   │
│ VersionSetMgr│                          │ DeployHistory     │
└──────────────┴──────────────────────────┴───────────────────┘
```

**Data flows top-down**: The Pipeline Engine triggers builds (Build System) and deployments
(Deployment System). The Deployment System reads artifacts from the shared Artifact Repository.
The Build System writes artifacts into it.


---

## Project Structure

```
src/
├── shared/                        # Shared types, errors, Result monad
│   ├── result.ts                  # Result<T,E> type + ok()/err() constructors
│   ├── types.ts                   # Build System domain models
│   ├── deployment-types.ts        # Deployment System domain models
│   ├── pipeline-types.ts          # Pipeline Engine domain models
│   └── errors.ts                  # Discriminated union error types per subsystem
│
├── build-system/                  # Subsystem 1
│   ├── package-registry.ts        # Package registration + validation
│   ├── dependency-resolver.ts     # DAG resolution with cycle detection
│   ├── build-executor.ts          # Build orchestration + caching
│   ├── version-set-manager.ts     # Immutable version set creation/validation
│   ├── artifact-repository.ts     # Versioned artifact storage
│   ├── build-logger.ts            # Structured build logs
│   └── index.ts                   # Barrel exports
│
├── deployment-system/             # Subsystem 2
│   ├── target-registry.ts         # Deployment target registration
│   ├── deployment-plan-creator.ts # Plan validation + creation
│   ├── deployment-executor.ts     # Ordered deployment with halt-on-failure
│   ├── deployment-history.ts      # Per-target deployment record store
│   ├── rollback-manager.ts        # Rollback to previous artifact version
│   └── index.ts                   # Barrel exports
│
├── pipeline-engine/               # Subsystem 3
│   ├── pipeline-parser.ts         # JSON → PipelineDefinition (with validation)
│   ├── pipeline-printer.ts        # PipelineDefinition → JSON (round-trip safe)
│   ├── pipeline-executor.ts       # Stage/step execution, parallel steps, approvals
│   ├── pipeline-trigger.ts        # Auto-trigger on commit, manual trigger, concurrency
│   ├── pipeline-logger.ts         # Structured pipeline run logs
│   └── index.ts                   # Barrel exports
│
├── ui/                            # Web dashboard
│   ├── server.ts                  # Express API server + static file serving
│   └── dashboard.html             # Single-page CodePipeline-style UI
│
└── index.ts                       # Root barrel export

tests/
├── build-system/                  # 5 test files, Properties 1–13
├── deployment-system/             # 3 test files, Properties 14–19
├── pipeline-engine/               # 4 test files, Properties 20–27 + approval tests
└── observability/                 # 1 test file,  Properties 28–30
```


---

## Layered Architecture

The codebase follows a strict three-layer architecture. Dependencies flow inward only.

```
┌───────────────────────────────────────────────┐
│              UI / API Layer                    │  src/ui/server.ts
│  Express routes, HTML dashboard               │  src/ui/dashboard.html
├───────────────────────────────────────────────┤
│           Business Logic Layer                 │  src/build-system/*
│  PackageRegistry, DependencyResolver,          │  src/deployment-system/*
│  BuildExecutor, DeploymentExecutor,            │  src/pipeline-engine/*
│  PipelineExecutor, RollbackManager, etc.       │
├───────────────────────────────────────────────┤
│           Shared / Domain Layer                │  src/shared/*
│  Types, Errors, Result<T,E>                    │
│  (No logic — pure data definitions)            │
└───────────────────────────────────────────────┘
```

**Rules enforced by this layout:**

- `src/shared/` has zero imports from other `src/` directories. It is the foundation.
- Business logic classes import only from `src/shared/` and from other classes within
  the same subsystem (or from `ArtifactRepository` which is the shared integration point).
- `src/ui/` imports from business logic and shared. Nothing imports from `src/ui/`.
- Each subsystem exposes a barrel `index.ts` that re-exports its public API.
  Consumers import from the barrel, not from internal files.

**Pluggable storage pattern:** All persistence is in-memory (`Map<string, T>`).
Every store is encapsulated inside a class. To swap to a database, replace the
class internals without changing any caller. No persistence interface leaks into
business logic signatures — they accept and return domain types only.


---

## Dependency Graph Between Components

```
PipelineTrigger
    │
    ▼
PipelineExecutor ──► StepActionExecutor (interface)
    │                 ApprovalProvider   (interface)
    │                 PipelineLogger
    │
    ├── (triggers) ──► BuildExecutor
    │                      │
    │                      ├── PackageRegistry
    │                      ├── DependencyResolver ──► PackageRegistry
    │                      ├── ArtifactRepository  ◄─── (shared)
    │                      ├── VersionSetManager ──► ArtifactRepository
    │                      └── BuildLogger
    │
    └── (triggers) ──► DeploymentExecutor
                           │
                           ├── DeploymentHistory
                           ├── ArtifactRepository  ◄─── (shared)
                           └── DeployAgent (interface)

DeploymentPlanCreator ──► ArtifactRepository
                          TargetRegistry

RollbackManager ──► DeploymentHistory
                    TargetRegistry
                    DeployAgent (interface)
```

**Key interfaces (dependency injection seams):**

| Interface            | Default Implementation       | Purpose                              |
|----------------------|------------------------------|--------------------------------------|
| `BuildStepExecutor`  | `DefaultBuildStepExecutor`   | Executes shell commands for builds   |
| `DeployAgent`        | `DefaultDeployAgent`         | Pushes artifacts to targets          |
| `StepActionExecutor` | `DefaultStepActionExecutor`  | Runs pipeline step actions           |
| `ApprovalProvider`   | `AutoApprovalProvider`       | Handles manual approval gates        |

All defaults are no-op/auto-approve for testing. In production, inject real implementations.


---

## Subsystem 1: Build System

### Code Flow — Package Registration

```
Operator submits PackageManifest
         │
         ▼
PackageRegistry.register(manifest)
         │
         ├── 1. Validate required fields (name, version, buildSteps)
         │       → InvalidManifest error if missing
         │
         ├── 2. Check duplicate name against packagesByName index
         │       → DuplicateName error if exists
         │
         ├── 3. Validate all declared dependencies exist in registry
         │       → UnresolvedDeps error listing missing names
         │
         └── 4. Assign unique ID (pkg-N), create Package, store in both indexes
                 → Return Result<Package, RegistrationError>
```

**Storage:** Dual-indexed `Map` — by ID (`packagesById`) and by name (`packagesByName`).
Lookups by either key are O(1).

### Code Flow — Dependency Resolution

```
BuildExecutor or caller requests resolve(packageId, versionSet?)
         │
         ▼
DependencyResolver.resolve()
         │
         ├── 1. Look up root package by ID
         │       → PackageNotFound if missing
         │
         ├── 2. Recursive DFS traversal with three sets:
         │       • visiting (currently on stack — for cycle detection)
         │       • visited  (fully processed — skip)
         │       • nodes    (accumulated DependencyGraph)
         │
         ├── 3. For each package:
         │       a. If in `visiting` → CycleDetected (extract cycle path from stack)
         │       b. If in `visited`  → skip (already resolved)
         │       c. Look up each dependency by name → MissingDependency if not found
         │       d. Recurse into each dependency
         │       e. Pin version: use VersionSet mapping if provided, else package's own version
         │       f. Add DependencyNode to graph, move from visiting → visited
         │
         └── 4. Return Result<DependencyGraph, ResolutionError>
```

**Determinism guarantee:** Same package + same VersionSet = same graph. The DFS visits
dependencies in declaration order, and version pinning is a pure lookup.


### Code Flow — Build Execution

```
Operator triggers build(packageId, versionSet?)
         │
         ▼
BuildExecutor.build()
         │
         ├── 1. Look up package → PackageNotFound if missing
         │
         ├── 2. If VersionSet provided, validate it still has all artifacts
         │       (VersionSetManager.validate) → ResolutionFailed if stale
         │
         ├── 3. Resolve full dependency graph
         │       (DependencyResolver.resolve) → ResolutionFailed on error
         │
         ├── 4. Cache check:
         │       • Compute source hash (stable per packageId)
         │       • Compare with previous hash for same cache key
         │       • If match AND cached artifact exists → return cached (no rebuild)
         │
         ├── 5. Execute build steps in order (sorted by step.order):
         │       for each step:
         │         result = stepExecutor.execute(step.command)
         │         if failed → log, return StepFailed error (halt)
         │         if ok     → record output, continue
         │
         ├── 6. Create BuildArtifact, publish to ArtifactRepository with metadata
         │
         ├── 7. Update cache (buildCache + sourceHashes)
         │
         └── 8. Log build result via BuildLogger
                 → Return Result<BuildArtifact, BuildError>
```

**Cache key:** `packageId` alone, or `packageId:versionSetId` when a VersionSet is used.
Cache invalidation: call `invalidateCache(packageId)` to force a rebuild.

### Code Flow — Version Set Management

```
VersionSetManager.create(spec)
         │
         ├── 1. Check name uniqueness → DuplicateName if exists
         │
         ├── 2. For each (packageName, version) in spec:
         │       Check ArtifactRepository.exists()
         │       → MissingVersions error listing all missing pairs
         │
         └── 3. Create immutable VersionSet (frozen: true), store, return

VersionSetManager.validate(versionSetId)
         │
         └── Re-check all referenced artifacts still exist
             (catches deletions after creation)
```

**Immutability:** VersionSet.versions is a `new Map(spec.versions)` — a copy at creation time.
The `frozen: true` literal type enforces immutability at the type level.


---

## Subsystem 2: Deployment System

### Code Flow — Deployment Plan Creation

```
Operator submits DeploymentPlanSpec
         │
         ▼
DeploymentPlanCreator.create(spec)
         │
         ├── 1. Validate all artifact refs exist in ArtifactRepository
         │       Collect invalid artifacts list
         │
         ├── 2. Validate all target IDs are registered AND reachable
         │       Collect invalid targets list
         │
         ├── 3. Also validate per-target artifactRefs (deduped)
         │
         ├── 4. Error aggregation:
         │       • Both invalid → Mixed error (lists both)
         │       • Only artifacts → InvalidArtifacts
         │       • Only targets   → InvalidTargets
         │
         └── 5. Sort targets by order field, assign plan ID
                 → Return Result<DeploymentPlan, PlanError>
```

### Code Flow — Deployment Execution

```
DeploymentExecutor.execute(plan)
         │
         ├── 1. Initialize all target statuses as "pending"
         │
         ├── 2. Sort targets by order (ascending)
         │
         ├── 3. For each target in order:
         │       a. Set status → "in-progress"
         │       b. For each artifactRef on this target:
         │            result = deployAgent.deploy(targetId, packageName, version)
         │            if failed:
         │              • Set status → "failed"
         │              • Record failed DeploymentRecord in history
         │              • HALT — do not deploy to remaining targets
         │              • Return TargetFailed error
         │            if ok:
         │              • Record succeeded DeploymentRecord in history
         │       c. Set status → "succeeded"
         │
         └── 4. Return Result<DeploymentResult, DeploymentError>
                 (DeploymentResult contains all records)
```

**Halt-on-failure:** The `for` loop breaks on first target failure. Remaining targets
stay in "pending" status. The operator is notified via the error return.

### Code Flow — Rollback

```
RollbackManager.rollback(targetId)
         │
         ├── 1. Look up target in TargetRegistry → TargetNotFound if missing
         │
         ├── 2. Get previous deployment from history:
         │       DeploymentHistory.getPrevious(targetId)
         │       (returns the 2nd entry in reverse-chronological order)
         │       → NoHistory error if fewer than 2 records
         │
         ├── 3. Deploy previous artifact version:
         │       deployAgent.deploy(targetId, previous.packageName, previous.version)
         │       → DeployFailed if agent fails
         │
         └── 4. Record rollback as new DeploymentRecord (outcome: "rolled-back")
                 Add to history → history grows by exactly 1 entry
                 → Return Result<DeploymentRecord, RollbackError>
```

**History retention:** DeploymentHistory stores all records in an append-only list per target.
`getHistory()` returns reverse-chronological (newest first). No pruning — retains everything.


---

## Subsystem 3: Pipeline Engine

### Code Flow — Pipeline Definition Parsing

```
Input: JSON string
         │
         ▼
PipelineParser.parse(input)
         │
         ├── 1. JSON.parse() → SyntaxError if invalid JSON
         │
         ├── 2. Validate top-level: name (string), stages (non-empty array)
         │
         ├── 3. For each stage:
         │       • Validate name (string)
         │       • Validate steps (non-empty array)
         │       • For each step:
         │           - Validate name (string)
         │           - Validate action ∈ {build, test, deploy, custom, approval}
         │             → UnknownAction error if not in set
         │           - Preserve optional: script, parallel, approvalMessage
         │       • Preserve optional: inputArtifacts, outputArtifacts
         │
         ├── 4. Parse optional trigger config (repository, branch, allowParallelRuns)
         │
         └── 5. Assign ID (from JSON or auto-generated)
                 → Return Result<PipelineDefinition, ParseError>

Round-trip guarantee:
  parse(print(def)) ≡ def        (for all valid definitions)
  parse(print(parse(s))) ≡ parse(s)  (for all valid strings)
```

**PipelinePrinter** serializes back to JSON with the same structure. Fields like `parallel`
and `approvalMessage` are only included when truthy/defined, keeping output clean.

### Code Flow — Pipeline Execution (with Approval Gates)

```
PipelineExecutor.execute(definitionId, commitRef?)
         │
         ├── 1. Look up definition → DefinitionNotFound if missing
         │
         ├── 2. Create PipelineRun:
         │       • Initialize all stages as "pending"
         │       • Initialize all steps as "pending"
         │       • Copy inputArtifacts/outputArtifacts from definition to run
         │       • For approval steps: set approvalStatus = "pending"
         │       • Record in runs map, mark as active
         │
         ├── 3. For each stage (sequential):
         │       a. Set stage status → "running", record startedAt
         │       b. Partition steps into parallel[] and sequential[]
         │       c. Execute parallel steps concurrently (Promise.all):
         │            Each step: executeStep() → succeeded or failed
         │       d. If no parallel failures, execute sequential steps in order:
         │            Each step: executeStep() → succeeded or failed
         │            Break on first failure
         │       e. If any step failed:
         │            • Stage → "failed", run → "failed"
         │            • All remaining stages → "skipped"
         │            • All steps in remaining stages → "skipped"
         │            • Return StepFailed error
         │       f. Stage → "succeeded"
         │
         ├── 4. Run → "succeeded", record completedAt
         │
         └── 5. Return Result<PipelineRun, PipelineError>
```


### Code Flow — Step Execution (executeStep)

```
executeStep(runId, stageName, stepDef, stepRun)
         │
         ├── If action === "approval":
         │       │
         │       ▼
         │   approvalProvider.waitForApproval(runId, stageName, stepName, message)
         │       │
         │       ├── AutoApprovalProvider: resolves immediately (approved: true)
         │       │
         │       └── CallbackApprovalProvider: blocks (Promise) until external call:
         │               • approve(runId, stage, step, user) → resolves approved
         │               • reject(runId, stage, step, user)  → resolves rejected
         │           │
         │           ├── If approved: stepRun.approvalStatus = "approved"
         │           │                stepRun.approvedBy = user
         │           │                → ok(undefined)
         │           │
         │           └── If rejected: stepRun.approvalStatus = "rejected"
         │                            → err("Approval rejected by {user}")
         │
         └── If action !== "approval":
                 actionExecutor.execute(action, script)
                 → ok(undefined) or err(reason)
```

**Approval blocking mechanism:** `CallbackApprovalProvider` stores a `Promise` resolve
function in a `Map` keyed by `runId:stageName:stepName`. The pipeline executor `await`s
this promise. When the UI (or API) calls `approve()` or `reject()`, it resolves the
promise, unblocking the executor. This is a clean async coordination pattern — no polling.

### Code Flow — Pipeline Triggering

```
PipelineTrigger.onCommit(repo, branch, commitRef)
         │
         ├── 1. Look up definitionId by "repo:branch" index
         │       → silent return if no match
         │
         ├── 2. Check concurrency policy:
         │       If parallel disabled AND run already active → skip
         │
         └── 3. executor.execute(definitionId, commitRef)

PipelineTrigger.manualTrigger(definitionId, commitRef?)
         │
         ├── 1. Look up definition → DefinitionNotFound if missing
         │
         ├── 2. Check concurrency → ConcurrentRun error if blocked
         │
         ├── 3. Resolve commitRef: use provided, or "latest-{branch}"
         │
         └── 4. executor.execute(definitionId, commitRef)
                 → Return Result<PipelineRun, TriggerError>
```

### Stage Artifacts

Artifacts flow between stages as metadata declarations:

```
Stage: Source
  outputArtifacts: [{ name: "SourceOutput", packageName: "my-app", version: "1.0.0" }]
         │
         ▼ (artifact name reference)
Stage: Build
  inputArtifacts:  [{ name: "SourceOutput" }]
  outputArtifacts: [{ name: "BuildOutput", packageName: "my-app", version: "1.0.0" }]
         │
         ▼
Stage: Deploy
  inputArtifacts:  [{ name: "BuildOutput" }]
```

Artifacts are declarative metadata — they describe what flows between stages for
visibility and validation. The actual data transfer happens through the Artifact Repository.


---

## Cross-Cutting: Error Handling

The platform uses a `Result<T, E>` algebraic type instead of thrown exceptions:

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

**Why Result instead of exceptions:**
- Errors are visible in function signatures — callers must handle both paths
- No hidden control flow — you can trace error propagation by reading the code
- Discriminated union errors (`error.type`) enable exhaustive switch/case handling
- Unexpected infrastructure failures (OOM, etc.) still throw and are caught at boundaries

**Error type taxonomy:**

| Subsystem   | Error Type          | Variants                                          |
|-------------|---------------------|---------------------------------------------------|
| Build       | `RegistrationError` | DuplicateName, InvalidManifest, UnresolvedDeps    |
| Build       | `ResolutionError`   | CycleDetected, MissingDependency, PackageNotFound |
| Build       | `BuildError`        | StepFailed, ResolutionFailed, PackageNotFound     |
| Build       | `VersionSetError`   | MissingVersions, DuplicateName                    |
| Build       | `ArtifactError`     | NotFound, AlreadyExists                           |
| Deployment  | `PlanError`         | InvalidArtifacts, InvalidTargets, Mixed           |
| Deployment  | `DeploymentError`   | TargetFailed, PlanNotFound                        |
| Deployment  | `RollbackError`     | NoHistory, TargetNotFound, DeployFailed           |
| Pipeline    | `ParseError`        | SyntaxError, UnknownAction                        |
| Pipeline    | `PipelineError`     | StepFailed, DefinitionNotFound, ApprovalRejected  |
| Pipeline    | `TriggerError`      | ConcurrentRun, DefinitionNotFound                 |

Every error variant carries contextual data (the package name that conflicted, the cycle
path that was detected, the step that failed, etc.).

---

## Cross-Cutting: Observability

Three logging systems, one per subsystem, all following the same pattern:

**BuildLogger** — records per-build:
- packageId, startTime, endTime, status
- Per-step: stepName, output, status
- Query: `getLogsForPackage(id)` → reverse chronological

**DeploymentHistory** — records per-target:
- targetId, artifactVersion, packageName, deployedAt, deployedBy, outcome
- Query: `getHistory(targetId, limit?)` → reverse chronological

**PipelineLogger** — records per-run:
- Per-run: runId, definitionId, status, startedAt, completedAt
- Per-stage: stageName, duration
- Per-step: stepName, duration
- Structured log entries with timestamp, level, message, stage/step indices
- Query: `getRunLog(runId)`, `getDefinitionHistory(definitionId)` → reverse chronological


---

## UI Dashboard

### Architecture

```
Browser (dashboard.html)
    │
    │  fetch() every 2s (auto-refresh)
    │
    ▼
Express Server (server.ts)
    │
    ├── GET  /                        → Serve dashboard.html
    ├── GET  /api/pipelines           → All definitions + all runs
    ├── GET  /api/pipelines/:id       → Definition + its runs
    ├── GET  /api/runs/:id            → Single run detail
    ├── POST /api/pipelines/:id/run   → Trigger pipeline (async, non-blocking)
    ├── GET  /api/approvals           → Pending approval list
    ├── POST /api/approvals/approve   → Approve a pending step
    └── POST /api/approvals/reject    → Reject a pending step
    │
    ▼
PipelineExecutor + CallbackApprovalProvider (in-process)
```

**Key design decision:** `POST /api/pipelines/:id/run` does NOT await the full pipeline
execution. It fires `executor.execute()` without awaiting, waits 50ms for initialization,
then returns the run ID. This is critical because pipelines with approval steps would
block the HTTP response indefinitely otherwise.

### Visual Design

The dashboard renders a CodePipeline-style horizontal pipeline:

- Each stage is a card with colored border (green=succeeded, blue=running, red=failed, gray=pending)
- Stages are connected by arrows that inherit the predecessor's status color
- Steps within a stage show action icons (🔨 build, 🧪 test, 🚀 deploy, 🔒 approval)
- Artifact tags appear at the bottom of stage cards (⬇ input blue, ⬆ output green)
- Approval banners appear above the pipeline with Approve/Reject buttons
- Auto-refreshes every 2 seconds to show real-time progress

### Running the Dashboard

```bash
npm run ui
# → http://localhost:3000
```

Two demo pipelines are seeded:
1. "Production Release Pipeline" — Source → Build → Staging → Approval → Production
2. "CI Pipeline (No Approval)" — Build → Test (parallel) → Deploy


---

## Testing Architecture

### Dual Strategy: Unit Tests + Property-Based Tests

Every test file contains both:
- **Unit tests** — specific examples, edge cases, error conditions
- **Property-based tests** — universal invariants verified across random inputs (fast-check)

### Property Test Mapping

| Property | File                              | What It Verifies                              |
|----------|-----------------------------------|-----------------------------------------------|
| 1        | package-registry.test.ts          | Valid manifests get unique IDs                 |
| 2        | package-registry.test.ts          | Duplicate names rejected                       |
| 3        | package-registry.test.ts          | Invalid manifests rejected                     |
| 4        | dependency-resolver.test.ts       | Transitive dependency completeness             |
| 5        | dependency-resolver.test.ts       | Cycle detection (acyclic graphs resolve)       |
| 6        | dependency-resolver.test.ts       | Deterministic resolution                       |
| 7        | build-executor.test.ts            | Build steps execute in declared order          |
| 8        | build-executor.test.ts            | Build halts on step failure                    |
| 9        | build-executor.test.ts            | Build caching idempotence                      |
| 10       | version-set-manager.test.ts       | Version set immutability                       |
| 11       | dependency-resolver.test.ts       | Version set governs resolution                 |
| 12       | version-set-manager.test.ts       | Version set validation against artifact repo   |
| 13       | artifact-repository.test.ts       | Artifact storage round-trip                    |
| 14       | deployment-plan.test.ts           | Deployment plan validation                     |
| 15       | deployment-executor.test.ts       | Deployment execution order                     |
| 16       | deployment-executor.test.ts       | Deployment halts on target failure             |
| 17       | rollback-manager.test.ts          | Rollback redeploys previous version            |
| 18       | rollback-manager.test.ts          | Deployment history minimum retention           |
| 19       | rollback-manager.test.ts          | Rollback creates history entry                 |
| 20       | pipeline-parser.test.ts           | Pipeline definition round-trip                 |
| 21       | pipeline-parser.test.ts           | Parser rejects invalid action types            |
| 22       | pipeline-executor.test.ts         | Stage execution order + success status         |
| 23       | pipeline-executor.test.ts         | Parallel steps within a stage                  |
| 24       | pipeline-executor.test.ts         | Pipeline halts on step failure                 |
| 25       | pipeline-trigger.test.ts          | Automatic pipeline triggering                  |
| 26       | pipeline-trigger.test.ts          | Manual trigger uses correct commit             |
| 27       | pipeline-trigger.test.ts          | Concurrent run prevention                      |
| 28       | logging.test.ts                   | Build and pipeline log completeness            |
| 29       | logging.test.ts                   | Deployment history record completeness         |
| 30       | logging.test.ts                   | History query ordering (reverse chronological) |

Each property test runs 100 iterations minimum (`{ numRuns: 100 }`).

### Running Tests

```bash
npm test              # Run all 95 tests
npx vitest run        # Same thing
npx vitest run --reporter=verbose   # See every test name
```


---

## Maintenance Guide

### Adding a New Package to the Build System

No code changes needed. Use the `PackageRegistry.register()` API:

```typescript
const registry = new PackageRegistry();
registry.register({
  name: "my-new-service",
  version: "1.0.0",
  dependencies: [{ packageName: "shared-lib" }],
  buildSteps: [
    { name: "compile", command: "tsc", order: 1 },
    { name: "test", command: "vitest run", order: 2 },
  ],
});
```

### Adding a New Pipeline Action Type

1. Add the new type to `ActionType` union in `src/shared/pipeline-types.ts`:
   ```typescript
   export type ActionType = "build" | "test" | "deploy" | "custom" | "approval" | "notify";
   ```

2. Add it to `VALID_ACTIONS` in `src/pipeline-engine/pipeline-parser.ts`:
   ```typescript
   const VALID_ACTIONS: ActionType[] = [..., "notify"];
   ```

3. Handle it in `PipelineExecutor.executeStep()` if it needs special behavior
   (like `"approval"` does), or let it fall through to `actionExecutor.execute()`.

4. Update `VALID_ACTIONS` in `tests/pipeline-engine/pipeline-parser.test.ts`.

5. Add an icon mapping in `dashboard.html`'s `ACTION_ICONS` object.

### Adding a New Deployment Target Type

Register it via `TargetRegistry`:

```typescript
targetRegistry.register({
  id: "canary-us-east-1",
  name: "Canary US East",
  environment: "canary",
  reachable: true,
});
```

No code changes needed — targets are data, not code.

### Swapping In-Memory Storage for a Database

Each store is encapsulated in a single class. To migrate:

1. **ArtifactRepository** — Replace the `Map<string, StoredArtifact>` with database queries.
   The public API (`publish`, `get`, `delete`, `exists`) stays identical.

2. **PackageRegistry** — Replace `packagesById` and `packagesByName` Maps with DB tables.
   Add a unique constraint on `name`.

3. **DeploymentHistory** — Replace `Map<string, DeploymentRecord[]>` with a table indexed
   by `targetId` + `deployedAt DESC`.

4. **PipelineLogger** — Replace `Map<string, LogEntry[]>` with a log table.

**No caller code changes.** All persistence is behind class boundaries. The domain types
(`Package`, `DeploymentRecord`, `PipelineRun`, etc.) remain the same.

### Implementing a Real BuildStepExecutor

Replace `DefaultBuildStepExecutor` with one that shells out:

```typescript
import { exec } from "child_process";

class ShellBuildStepExecutor implements BuildStepExecutor {
  async execute(command: string): Promise<Result<string, string>> {
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) resolve(err(stderr || error.message));
        else resolve(ok(stdout));
      });
    });
  }
}
```

Inject it when constructing `BuildExecutor`:
```typescript
const executor = new BuildExecutor(registry, resolver, artifactRepo, vsManager, new ShellBuildStepExecutor());
```


### Implementing a Real DeployAgent

Replace `DefaultDeployAgent` with one that calls your deployment infrastructure:

```typescript
class K8sDeployAgent implements DeployAgent {
  async deploy(targetId: string, packageName: string, version: string): Promise<Result<void, string>> {
    // Pull artifact, apply k8s manifests, wait for rollout
    try {
      await kubectl.apply(targetId, packageName, version);
      return ok(undefined);
    } catch (e) {
      return err(e.message);
    }
  }
}
```

### Implementing a Real ApprovalProvider

For production use with external approval systems (Slack, PagerDuty, etc.):

```typescript
class SlackApprovalProvider implements ApprovalProvider {
  async waitForApproval(runId, stageName, stepName, message) {
    // Post to Slack channel, wait for reaction
    const response = await slackClient.postAndWaitForReaction(channel, message);
    return {
      approved: response.reaction === "thumbsup",
      approvedBy: response.user,
    };
  }
}
```

Or use `CallbackApprovalProvider` (already built) for webhook/UI-driven approvals.

### Adding New Correctness Properties

1. Define the property in `docs/` or the spec's `design.md`
2. Create a test with the comment tag:
   ```typescript
   // Feature: build-platform, Property N: Description
   it("Property N: description", () => {
     fc.assert(fc.property(...), { numRuns: 100 });
   });
   ```
3. Place it in the appropriate test file based on which component it validates

### Common Maintenance Tasks

| Task                          | What to Change                                    |
|-------------------------------|---------------------------------------------------|
| Add build step type           | Just data — no code change                        |
| Add pipeline action           | `ActionType` union + parser + optional executor   |
| Add deployment environment    | `TargetRegistry.register()` — data only           |
| Change artifact storage       | `ArtifactRepository` internals only               |
| Change deployment mechanism   | Implement `DeployAgent` interface                 |
| Change build execution        | Implement `BuildStepExecutor` interface           |
| Change approval flow          | Implement `ApprovalProvider` interface            |
| Add API endpoint              | `src/ui/server.ts` — add Express route            |
| Change UI visualization       | `src/ui/dashboard.html` — pure HTML/CSS/JS        |
| Add a new subsystem           | New `src/{name}/` directory + barrel `index.ts`   |

### Performance Considerations

- **Dependency resolution** is O(V+E) where V=packages, E=dependency edges. The DFS
  visits each node once. For very large graphs (10k+ packages), consider memoizing
  subgraph resolutions.

- **Build caching** is keyed by packageId + versionSetId. Cache invalidation is manual
  (`invalidateCache()`). In production, compute real source hashes (e.g., hash of all
  source files) for automatic invalidation.

- **Pipeline execution** runs stages sequentially and steps within a stage either
  sequentially or in parallel. The bottleneck is the slowest step in each stage.
  Approval steps block indefinitely until resolved — ensure timeouts in production.

- **In-memory storage** is O(1) lookup but unbounded growth. For production, implement
  retention policies (e.g., keep last N builds, prune old deployment records).

### Security Considerations

- **Approval steps** should validate the approver's identity against an authorization
  system. The current implementation accepts any `approvedBy` string.

- **Build step execution** runs arbitrary commands. In production, sandbox build
  execution (containers, VMs) to prevent supply-chain attacks.

- **API endpoints** have no authentication. Add middleware for auth/authz before
  exposing to a network.

- **Artifact integrity** — consider adding checksums/signatures to `BuildArtifact`
  to detect tampering between build and deployment.
