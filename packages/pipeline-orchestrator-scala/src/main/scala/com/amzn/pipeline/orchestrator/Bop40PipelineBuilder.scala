package com.amzn.pipeline.orchestrator

import com.amzn.pipeline.model.*

/**
 * Builds the BOP 40 pipeline definition.
 *
 * Pipeline stages:
 *   1. Extract (C++)     — Pull GL data from FAST Redshift using recursive rollup queries
 *   2. Compare (Java)    — Compare TB with register balances, build financial sections
 *   3. Report (Python)   — Generate Excel workbook with all 5 geos
 *   4. Validate (Scala)  — Cross-geo validation and pipeline completion
 *
 * Frame flow:
 *   Extract → [rollup_accounts, gl_transactions, ledgers, registers, tb_ledgers]
 *   Compare → [comparison_results, bop40_sections]
 *   Report  → [bop40_excel]
 *   Validate → [validation_results]
 */
object Bop40PipelineBuilder:

  def build(period: String, fiscalYear: String): Bop40Pipeline =
    val stages = List(
      // Stage 1: C++ OFA Extractor — extracts all frames from FAST Redshift
      PipelineStage(
        name = "Extract OFA GL Data",
        packageName = "ofa-extractor-cpp",
        language = "cpp",
        command = s"./ofa_extract_cli $period $fiscalYear",
        inputFrames = List.empty,
        outputFrames = List(
          "rollup_accounts", "gl_transactions", "ledgers", "registers", "tb_ledgers"
        ),
        geos = Geos.All,
      ),

      // Stage 2: Java TB Comparator — compares TB, builds BOP sections
      PipelineStage(
        name = "Compare Trial Balance & Build Sections",
        packageName = "tb-comparator-java",
        language = "java",
        command = s"java -jar tb-comparator.jar --period $period --fiscal-year $fiscalYear",
        inputFrames = List("rollup_accounts", "tb_ledgers", "registers"),
        outputFrames = List("comparison_results", "bop40_sections"),
        geos = Geos.All,
      ),

      // Stage 3: Python Report Generator — produces Excel workbook
      PipelineStage(
        name = "Generate BOP 40 Excel Report",
        packageName = "bop40-report-python",
        language = "python",
        command = s"python -m bop40_report.cli $period $fiscalYear bop40_report_$period.xlsx",
        inputFrames = List("bop40_sections"),
        outputFrames = List("bop40_excel"),
        geos = Geos.All,
      ),

      // Stage 4: Scala Validator — cross-geo validation
      PipelineStage(
        name = "Cross-Geo Validation",
        packageName = "pipeline-orchestrator-scala",
        language = "scala",
        command = s"sbt 'runMain com.amzn.pipeline.validator.Bop40Validator $period'",
        inputFrames = List("bop40_sections", "comparison_results"),
        outputFrames = List("validation_results"),
        geos = Geos.All,
      ),
    )

    Bop40Pipeline(
      id = s"bop40-$period",
      name = s"BOP 40 Report Pipeline — $period",
      period = period,
      fiscalYear = fiscalYear,
      stages = stages,
    )
