package com.amzn.pipeline

import com.amzn.pipeline.orchestrator.*
import com.amzn.pipeline.model.*

/**
 * Entry point — builds and executes the full BOP 40 pipeline.
 *
 * Usage: sbt "run 2026-03 2026"
 */
@main def run(args: String*): Unit =
  val period = args.headOption.getOrElse("2026-03")
  val fiscalYear = if args.length > 1 then args(1) else "2026"

  println(s"╔══════════════════════════════════════════════╗")
  println(s"║  BOP 40 Pipeline Orchestrator                ║")
  println(s"║  Period: $period | FY: $fiscalYear                  ║")
  println(s"║  Geos: ${Geos.All.mkString(", ")}                    ║")
  println(s"╚══════════════════════════════════════════════╝\n")

  // Build pipeline definition
  val pipeline = Bop40PipelineBuilder.build(period, fiscalYear)
  println(s"Pipeline: ${pipeline.name}")
  println(s"Stages: ${pipeline.stages.length}\n")

  for (stage, i) <- pipeline.stages.zipWithIndex do
    println(s"  ${i + 1}. ${stage.name}")
    println(s"     Package: ${stage.packageName} (${stage.language})")
    println(s"     Input:   ${if stage.inputFrames.isEmpty then "(none)" else stage.inputFrames.mkString(", ")}")
    println(s"     Output:  ${stage.outputFrames.mkString(", ")}")
    println()

  // Execute
  val frameStore = new FrameStore()
  val executor = new PipelineExecutor(frameStore)
  val result = executor.execute(pipeline)

  println(s"\n═══ Pipeline Result ═══")
  println(s"Status: ${result.status}")
  println(s"Duration: ${result.duration}ms")
  println()

  for sr <- result.stageResults do
    val icon = sr.status match
      case PipelineStatus.Succeeded => "✓"
      case PipelineStatus.Failed    => "✗"
      case PipelineStatus.Skipped   => "–"
      case _                        => "?"
    println(s"  $icon ${sr.stageName} (${sr.duration}ms)")
    sr.error.foreach(e => println(s"    Error: $e"))

  println(s"\nFrames produced: ${frameStore.listAll().length}")
