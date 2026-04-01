package com.amzn.pipeline

import com.amzn.pipeline.model.*
import com.amzn.pipeline.orchestrator.*
import com.amzn.pipeline.validator.*
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class Bop40PipelineSpec extends AnyFlatSpec with Matchers:

  "Bop40PipelineBuilder" should "create a 4-stage pipeline" in {
    val pipeline = Bop40PipelineBuilder.build("2026-03", "2026")
    pipeline.stages.length shouldBe 4
    pipeline.stages.head.language shouldBe "cpp"
    pipeline.stages(1).language shouldBe "java"
    pipeline.stages(2).language shouldBe "python"
    pipeline.stages(3).language shouldBe "scala"
  }

  it should "include all 5 geos in every stage" in {
    val pipeline = Bop40PipelineBuilder.build("2026-03", "2026")
    for stage <- pipeline.stages do
      stage.geos should contain theSameElementsAs Geos.All
  }

  it should "have correct frame dependencies" in {
    val pipeline = Bop40PipelineBuilder.build("2026-03", "2026")

    // Extract has no inputs
    pipeline.stages.head.inputFrames shouldBe empty

    // Compare consumes extract outputs
    pipeline.stages(1).inputFrames should contain("rollup_accounts")
    pipeline.stages(1).inputFrames should contain("tb_ledgers")

    // Report consumes compare outputs
    pipeline.stages(2).inputFrames should contain("bop40_sections")

    // Validate consumes compare outputs
    pipeline.stages(3).inputFrames should contain("comparison_results")
  }

  "PipelineExecutor" should "execute all stages successfully" in {
    val pipeline = Bop40PipelineBuilder.build("2026-03", "2026")
    val frameStore = new FrameStore()
    val executor = new PipelineExecutor(frameStore)

    val result = executor.execute(pipeline)
    result.status shouldBe PipelineStatus.Succeeded
    result.stageResults.length shouldBe 4
    result.stageResults.foreach(_.status shouldBe PipelineStatus.Succeeded)
  }

  it should "produce frames for all geos" in {
    val pipeline = Bop40PipelineBuilder.build("2026-03", "2026")
    val frameStore = new FrameStore()
    val executor = new PipelineExecutor(frameStore)
    executor.execute(pipeline)

    for geo <- Geos.All do
      frameStore.listForGeo(geo) should not be empty
  }

  "FrameStore" should "track frame metadata" in {
    val store = new FrameStore()
    store.exists("test", "US") shouldBe false

    store.register(FrameMetadata(
      "test", "US", "2026-03", "stage1",
      java.time.Instant.now(), 100, 1024
    ))

    store.exists("test", "US") shouldBe true
    store.get("test", "US").get.rowCount shouldBe 100
  }

  "Bop40Validator" should "pass when all geos are balanced" in {
    val bsChecks = Geos.All.map(_ -> BigDecimal(0)).toMap
    val tbBalanced = Geos.All.map(_ -> true).toMap
    val results = Bop40Validator.validateAllGeos(bsChecks, tbBalanced, Geos.All.toSet)

    results.length shouldBe 5
    results.foreach(_.passed shouldBe true)
  }

  it should "fail when a geo has unbalanced BS" in {
    val bsChecks = Map("US" -> BigDecimal(0), "EU" -> BigDecimal(1000),
      "JP" -> BigDecimal(0), "IN" -> BigDecimal(0), "BR" -> BigDecimal(0))
    val tbBalanced = Geos.All.map(_ -> true).toMap
    val results = Bop40Validator.validateAllGeos(bsChecks, tbBalanced, Geos.All.toSet)

    results.find(_.geo == "EU").get.passed shouldBe false
    results.find(_.geo == "US").get.passed shouldBe true
  }

  it should "fail when a geo is missing data" in {
    val bsChecks = Geos.All.map(_ -> BigDecimal(0)).toMap
    val tbBalanced = Geos.All.map(_ -> true).toMap
    val results = Bop40Validator.validateAllGeos(bsChecks, tbBalanced, Set("US", "EU", "JP", "IN"))

    results.find(_.geo == "BR").get.passed shouldBe false
  }
