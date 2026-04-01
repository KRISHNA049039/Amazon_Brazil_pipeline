import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { PipelineExecutor, CallbackApprovalProvider, DefaultStepActionExecutor } from "../pipeline-engine/pipeline-executor.js";
import { PipelineLogger } from "../pipeline-engine/pipeline-logger.js";
import { PipelineDefinition } from "../shared/pipeline-types.js";
import { PackageRegistry } from "../build-system/package-registry.js";
import { registerBop40Packages, bop40PipelineDefinition } from "./bop40-seed.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ─── Bootstrap pipeline engine with approval support ───
const logger = new PipelineLogger();
const approvalProvider = new CallbackApprovalProvider();
const actionExecutor = new DefaultStepActionExecutor();
const executor = new PipelineExecutor(actionExecutor, logger, approvalProvider);

// ─── Register BOP 40 packages with build system ───
const packageRegistry = new PackageRegistry();
registerBop40Packages(packageRegistry);
console.log(`Registered ${packageRegistry.list().length} BOP 40 packages`);

// ─── Register BOP 40 pipeline ───
executor.registerDefinition(bop40PipelineDefinition);

// Seed a demo pipeline with artifacts and approval gate
const demoPipeline: PipelineDefinition = {
  id: "demo-pipeline",
  name: "Production Release Pipeline",
  stages: [
    {
      name: "Source",
      steps: [{ name: "Checkout", action: "custom", script: "git checkout" }],
      outputArtifacts: [{ name: "SourceOutput", packageName: "my-app", version: "1.0.0" }],
    },
    {
      name: "Build",
      steps: [
        { name: "Compile", action: "build", script: "tsc" },
        { name: "Unit Tests", action: "test", script: "vitest run" },
      ],
      inputArtifacts: [{ name: "SourceOutput" }],
      outputArtifacts: [{ name: "BuildOutput", packageName: "my-app", version: "1.0.0" }],
    },
    {
      name: "Deploy to Staging",
      steps: [{ name: "Deploy Staging", action: "deploy", script: "deploy --env staging" }],
      inputArtifacts: [{ name: "BuildOutput" }],
    },
    {
      name: "Approval",
      steps: [
        {
          name: "Manual Approval",
          action: "approval",
          approvalMessage: "Please review the staging deployment and approve for production release.",
        },
      ],
    },
    {
      name: "Deploy to Production",
      steps: [{ name: "Deploy Prod", action: "deploy", script: "deploy --env production" }],
      inputArtifacts: [{ name: "BuildOutput" }],
    },
  ],
  trigger: { repository: "my-app", branch: "main", allowParallelRuns: false },
};

executor.registerDefinition(demoPipeline);

// Also seed a simpler pipeline
const simplePipeline: PipelineDefinition = {
  id: "simple-ci",
  name: "CI Pipeline (No Approval)",
  stages: [
    {
      name: "Build",
      steps: [{ name: "Compile", action: "build" }],
      outputArtifacts: [{ name: "AppBinary", packageName: "service-b", version: "2.1.0" }],
    },
    {
      name: "Test",
      steps: [
        { name: "Unit Tests", action: "test", parallel: true },
        { name: "Integration Tests", action: "test", parallel: true },
      ],
      inputArtifacts: [{ name: "AppBinary" }],
    },
    {
      name: "Deploy",
      steps: [{ name: "Deploy", action: "deploy" }],
      inputArtifacts: [{ name: "AppBinary" }],
    },
  ],
};

executor.registerDefinition(simplePipeline);

// ─── API Routes ───

app.get("/api/packages", (_req, res) => {
  const packages = packageRegistry.list().map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    dependencies: p.dependencies,
    buildSteps: p.buildSteps,
    registeredAt: p.registeredAt.toISOString(),
  }));
  res.json(packages);
});

app.get("/api/pipelines", (_req, res) => {
  const defs = executor.getAllDefinitions();
  const runs = executor.getAllRuns();
  res.json({
    definitions: defs,
    runs: runs.map(serializeRun),
  });
});

app.get("/api/pipelines/:id", (req, res) => {
  const def = executor.getDefinition(req.params.id);
  if (!def) return res.status(404).json({ error: "Not found" });

  const allRuns = executor.getAllRuns().filter((r) => r.definitionId === req.params.id);
  res.json({ definition: def, runs: allRuns.map(serializeRun) });
});

app.get("/api/runs/:id", (req, res) => {
  const run = executor.getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json(serializeRun(run));
});

app.post("/api/pipelines/:id/run", async (req, res) => {
  const commitRef = req.body?.commitRef ?? "HEAD";
  // Execute async — don't await (approval steps block)
  executor.execute(req.params.id, commitRef).then(() => {}).catch(() => {});
  // Give it a moment to initialize
  await new Promise((r) => setTimeout(r, 50));
  const runs = executor.getAllRuns().filter((r) => r.definitionId === req.params.id);
  res.json({ message: "Pipeline triggered", latestRun: runs.length > 0 ? serializeRun(runs[0]) : null });
});

app.get("/api/approvals", (_req, res) => {
  res.json(approvalProvider.getPendingApprovals());
});

app.post("/api/approvals/approve", (req, res) => {
  const { runId, stageName, stepName, approvedBy } = req.body;
  const ok = approvalProvider.approve(runId, stageName, stepName, approvedBy ?? "UI Operator");
  if (ok) {
    res.json({ message: "Approved" });
  } else {
    res.status(404).json({ error: "No pending approval found" });
  }
});

app.post("/api/approvals/reject", (req, res) => {
  const { runId, stageName, stepName, rejectedBy } = req.body;
  const ok = approvalProvider.reject(runId, stageName, stepName, rejectedBy ?? "UI Operator");
  if (ok) {
    res.json({ message: "Rejected" });
  } else {
    res.status(404).json({ error: "No pending approval found" });
  }
});

function serializeRun(run: any) {
  return {
    ...run,
    startedAt: run.startedAt?.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    stages: run.stages.map((s: any) => ({
      ...s,
      startedAt: s.startedAt?.toISOString(),
      completedAt: s.completedAt?.toISOString(),
      steps: s.steps.map((st: any) => ({
        ...st,
        startedAt: st.startedAt?.toISOString(),
        completedAt: st.completedAt?.toISOString(),
      })),
    })),
  };
}

// ─── Serve static HTML ───
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`🚀 Pipeline Dashboard running at http://localhost:${PORT}`);
});
