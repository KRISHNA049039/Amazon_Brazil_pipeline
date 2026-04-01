package com.amzn.pipeline.orchestrator

import com.amzn.pipeline.model.FrameMetadata
import scala.collection.mutable

/**
 * In-memory store for frame metadata.
 * Tracks which frames have been produced by which stages.
 */
class FrameStore:
  private val frames = mutable.Map.empty[String, FrameMetadata]

  private def key(name: String, geo: String): String = s"$name:$geo"

  def register(meta: FrameMetadata): Unit =
    frames(key(meta.name, meta.geo)) = meta

  def get(name: String, geo: String): Option[FrameMetadata] =
    frames.get(key(name, geo))

  def exists(name: String, geo: String): Boolean =
    frames.contains(key(name, geo))

  def listForGeo(geo: String): List[FrameMetadata] =
    frames.values.filter(_.geo == geo).toList

  def listAll(): List[FrameMetadata] =
    frames.values.toList
