package com.amzn.pipeline.model

import java.time.Instant

/** BOP 40 geo codes */
object Geos:
  val All: List[String] = List("US", "EU", "JP", "IN", "BR")
  val Currencies: Map[String, String] = Map(
    "US" -> "USD", "EU" -> "EUR", "JP" -> "JPY", "IN" -> "INR", "BR" -> "BRL"
  )

/** Pipeline execution status */
enum PipelineStatus:
  case Pending, Running, Succeeded, Failed, Skipped

/** A single stage in the BOP 40 pipeline */
case class PipelineStage(
  name: String,
  packageName: String,       // which package to invoke
  language: String,           // cpp, java, python, scala
  command: String,            // build/run command
  inputFrames: List[String],  // frame names consumed
  outputFrames: List[String], // frame names produced
  geos: List[String],         // which geos this stage processes
  status: PipelineStatus = PipelineStatus.Pending,
  startedAt: Option[Instant] = None,
  completedAt: Option[Instant] = None,
  error: Option[String] = None,
)

/** Complete BOP 40 pipeline definition */
case class Bop40Pipeline(
  id: String,
  name: String,
  period: String,
  fiscalYear: String,
  stages: List[PipelineStage],
  status: PipelineStatus = PipelineStatus.Pending,
  startedAt: Option[Instant] = None,
  completedAt: Option[Instant] = None,
)

/** Result of a pipeline execution */
case class PipelineResult(
  pipelineId: String,
  status: PipelineStatus,
  stageResults: List[StageResult],
  duration: Long, // milliseconds
)

case class StageResult(
  stageName: String,
  status: PipelineStatus,
  duration: Long,
  framesProduced: List[String],
  error: Option[String] = None,
)

/** Frame metadata — tracks data flowing between stages */
case class FrameMetadata(
  name: String,
  geo: String,
  period: String,
  producedBy: String,   // stage name
  producedAt: Instant,
  rowCount: Long,
  sizeBytes: Long,
)
