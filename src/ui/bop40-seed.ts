/**
 * Seeds the build platform with the 4 BOP 40 packages and pipeline.
 * Called by the server on startup.
 */
import { PackageRegistry } from "../build-system/package-registry.js";
import { PipelineDefinition } from "../shared/pipeline-types.js";

export function registerBop40Packages(registry: PackageRegistry) {
  // Package 1: C++ OFA Extractor
  registry.register({
    name: "ofa-extractor-cpp",
    version: "1.0.0",
    dependencies: [],
    buildSteps: [
      { name: "cmake-configure", command: "cmake -B build -DCMAKE_BUILD_TYPE=Release", order: 1 },
      { name: "cmake-build", command: "cmake --build build --parallel", order: 2 },
      { name: "run-tests", command: "ctest --test-dir build --output-on-failure", order: 3 },
    ],
    metadata: {
      language: "C++",
      description: "Extracts OFA GL data from FAST Redshift using recursive rollup queries",
      frames: "rollup_accounts,gl_transactions,ledgers,registers,tb_ledgers",
    },
  });

  // Package 2: Java TB Comparator
  registry.register({
    name: "tb-comparator-java",
    version: "1.0.0",
    dependencies: [{ packageName: "ofa-extractor-cpp" }],
    buildSteps: [
      { name: "mvn-compile", command: "mvn compile", order: 1 },
      { name: "mvn-test", command: "mvn test", order: 2 },
      { name: "mvn-package", command: "mvn package -DskipTests", order: 3 },
    ],
    metadata: {
      language: "Java",
      description: "Compares GL trial balance with register balances, builds BOP 40 sections",
      frames: "comparison_results,bop40_sections",
    },
  });

  // Package 3: Python BOP 40 Report Generator
  registry.register({
    name: "bop40-report-python",
    version: "1.0.0",
    dependencies: [{ packageName: "tb-comparator-java" }],
    buildSteps: [
      { name: "pip-install", command: "pip install -e .[dev]", order: 1 },
      { name: "pytest", command: "pytest tests/ -v", order: 2 },
      { name: "build-wheel", command: "python -m build", order: 3 },
    ],
    metadata: {
      language: "Python",
      description: "Generates BOP 40 Excel workbook with all 5 geos",
      frames: "bop40_excel",
    },
  });

  // Package 4: Scala Pipeline Orchestrator
  registry.register({
    name: "pipeline-orchestrator-scala",
    version: "1.0.0",
    dependencies: [
      { packageName: "ofa-extractor-cpp" },
      { packageName: "tb-comparator-java" },
      { packageName: "bop40-report-python" },
    ],
    buildSteps: [
      { name: "sbt-compile", command: "sbt compile", order: 1 },
      { name: "sbt-test", command: "sbt test", order: 2 },
      { name: "sbt-package", command: "sbt package", order: 3 },
    ],
    metadata: {
      language: "Scala",
      description: "Orchestrates BOP 40 pipeline, cross-geo validation",
      frames: "validation_results",
    },
  });
}

/** BOP 40 pipeline definition for the Pipeline Engine */
export const bop40PipelineDefinition: PipelineDefinition = {
  id: "bop40-pipeline",
  name: "BOP 40 Accounting Report Pipeline",
  stages: [
    {
      name: "Extract (C++)",
      steps: [
        { name: "Build OFA Extractor", action: "build", script: "cmake --build build" },
        { name: "Extract GL Data", action: "custom", script: "./ofa_extract_cli 2026-03 2026" },
      ],
      outputArtifacts: [
        { name: "rollup_accounts", packageName: "ofa-extractor-cpp", version: "1.0.0" },
        { name: "gl_transactions", packageName: "ofa-extractor-cpp", version: "1.0.0" },
        { name: "tb_ledgers", packageName: "ofa-extractor-cpp", version: "1.0.0" },
      ],
    },
    {
      name: "Compare (Java)",
      steps: [
        { name: "Build TB Comparator", action: "build", script: "mvn package -DskipTests" },
        { name: "Run TB Comparison", action: "custom", script: "java -jar tb-comparator.jar" },
        { name: "Unit Tests", action: "test", script: "mvn test" },
      ],
      inputArtifacts: [
        { name: "rollup_accounts" },
        { name: "tb_ledgers" },
      ],
      outputArtifacts: [
        { name: "comparison_results", packageName: "tb-comparator-java", version: "1.0.0" },
        { name: "bop40_sections", packageName: "tb-comparator-java", version: "1.0.0" },
      ],
    },
    {
      name: "Approval Gate",
      steps: [
        {
          name: "Finance Review",
          action: "approval",
          approvalMessage: "TB comparison complete for all 5 geos. Please review variances before generating the BOP 40 Excel report.",
        },
      ],
    },
    {
      name: "Report (Python)",
      steps: [
        { name: "Install Dependencies", action: "custom", script: "pip install -e .[dev]" },
        { name: "Generate Excel", action: "custom", script: "python -m bop40_report.cli 2026-03 2026" },
        { name: "Report Tests", action: "test", script: "pytest tests/ -v" },
      ],
      inputArtifacts: [{ name: "bop40_sections" }],
      outputArtifacts: [
        { name: "bop40_excel", packageName: "bop40-report-python", version: "1.0.0" },
      ],
    },
    {
      name: "Validate (Scala)",
      steps: [
        { name: "Cross-Geo Validation", action: "custom", script: "sbt 'runMain com.amzn.pipeline.validator.Bop40Validator 2026-03'" },
        { name: "Scala Tests", action: "test", script: "sbt test" },
      ],
      inputArtifacts: [
        { name: "bop40_sections" },
        { name: "comparison_results" },
      ],
      outputArtifacts: [
        { name: "validation_results", packageName: "pipeline-orchestrator-scala", version: "1.0.0" },
      ],
    },
  ],
  trigger: {
    repository: "bop40-accounting",
    branch: "main",
    allowParallelRuns: false,
  },
};
