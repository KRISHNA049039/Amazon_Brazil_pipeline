package com.amzn.pipeline.orchestrator

import com.amzn.pipeline.model.*
import java.time.{Duration, Instant}

/**
 * Executes the BOP 40 pipeline stages in order.
 * Validates frame dependencies between stages.
 * Halts on first failure.
 */
class PipelineExecutor(frameStore: FrameStore):

  def execute(pipeline: Bop40Pipeline): PipelineResult =
    val startTime = Instant.now()
    var stageResults = List.empty[StageResult]
    var availableFrames = Set.empty[String]
    var failed = false

    for stage <- pipeline.stages if !failed do
      val stageStart = Instant.now()

      // Validate input frames are available
      val missingFrames = stage.inputFrames.filterNot(availableFrames.contains)
      if missingFrames.nonEmpty then
        val error = s"Missing input frames: ${missingFrames.mkString(", ")}"
        stageResults = stageResults :+ StageResult(
          stage.name, PipelineStatus.Failed,
          Duration.between(stageStart, Instant.now()).toMillis,
          List.empty, Some(error)
        )
        failed = true
      else
        // Execute stage for each geo
        val result = executeStage(stage, stageStart)
        stageResults = stageResults :+ result

        if result.status == PipelineStatus.Succeeded then
          availableFrames = availableFrames ++ stage.outputFrames
        else
          failed = true

    // Mark remaining stages as skipped
    val executedNames = stageResults.map(_.stageName).toSet
    val skipped = pipeline.stages
      .filterNot(s => executedNames.contains(s.name))
      .map(s => StageResult(s.name, PipelineStatus.Skipped, 0, List.empty))

    val totalDuration = Duration.between(startTime, Instant.now()).toMillis
    val finalStatus = if failed then PipelineStatus.Failed else PipelineStatus.Succeeded

    PipelineResult(pipeline.id, finalStatus, stageResults ++ skipped, totalDuration)

  private def executeStage(stage: PipelineStage, startTime: Instant): StageResult =
    try
      println(s"[Pipeline] Executing: ${stage.name} (${stage.language})")
      println(s"  Command: ${stage.command}")
      println(s"  Geos: ${stage.geos.mkString(", ")}")
      println(s"  Input frames: ${stage.inputFrames.mkString(", ")}")

      // Simulate stage execution
      // In production: shell out to the actual command per geo
      for geo <- stage.geos do
        for frame <- stage.outputFrames do
          frameStore.register(FrameMetadata(
            name = frame, geo = geo, period = "current",
            producedBy = stage.name, producedAt = Instant.now(),
            rowCount = 0, sizeBytes = 0,
          ))

      val duration = Duration.between(startTime, Instant.now()).toMillis
      println(s"  ✓ Completed in ${duration}ms")

      StageResult(stage.name, PipelineStatus.Succeeded, duration, stage.outputFrames)
    catch
      case e: Exception =>
        val duration = Duration.between(startTime, Instant.now()).toMillis
        StageResult(stage.name, PipelineStatus.Failed, duration, List.empty, Some(e.getMessage))
