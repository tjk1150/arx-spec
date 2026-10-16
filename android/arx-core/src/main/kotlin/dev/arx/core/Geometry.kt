package dev.arx.core

import kotlin.math.sqrt

/** Lengths are in target-width units: 1.0 equals the target image width (spec 3.1). */
data class Vec2(val x: Double, val y: Double) {
    val array: DoubleArray get() = doubleArrayOf(x, y)
}

data class Vec3(val x: Double, val y: Double, val z: Double) {
    val array: DoubleArray get() = doubleArrayOf(x, y, z)

    companion object {
        val ZERO = Vec3(0.0, 0.0, 0.0)
        val ONE = Vec3(1.0, 1.0, 1.0)
    }
}

/** Unit quaternion [x, y, z, w], right-handed. */
data class Quat(val x: Double, val y: Double, val z: Double, val w: Double) {
    val array: DoubleArray get() = doubleArrayOf(x, y, z, w)

    val norm: Double get() = sqrt(x * x + y * y + z * z + w * w)

    val normalized: Quat
        get() {
            val length = norm
            return Quat(x / length, y / length, z / length, w / length)
        }

    companion object {
        val IDENTITY = Quat(0.0, 0.0, 0.0, 1.0)
    }
}

/** A layer transform with defaults applied and the rotation normalized. */
data class ArxTransform(val position: Vec3, val rotation: Quat, val scale: Vec3) {
    /** M = T * R * S, column-major (glTF order): scale first, then rotate, then translate. */
    val matrix: DoubleArray
        get() {
            val (qx, qy, qz, qw) = rotation
            val (sx, sy, sz) = scale
            return doubleArrayOf(
                (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0.0,
                2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0.0,
                2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0.0,
                position.x, position.y, position.z, 1.0,
            )
        }

    companion object {
        val IDENTITY = ArxTransform(Vec3.ZERO, Quat.IDENTITY, Vec3.ONE)

        /** Applies the spec defaults and normalizes the rotation. */
        fun from(input: ArxManifest.TransformInput?): ArxTransform {
            val position = input?.position ?: listOf(0.0, 0.0, 0.0)
            val rotation = input?.rotation ?: listOf(0.0, 0.0, 0.0, 1.0)
            val scale = input?.scale ?: listOf(1.0, 1.0, 1.0)
            return ArxTransform(
                position = Vec3(position[0], position[1], position[2]),
                rotation = Quat(rotation[0], rotation[1], rotation[2], rotation[3]).normalized,
                scale = Vec3(scale[0], scale[1], scale[2]),
            )
        }
    }
}

object Geometry {
    /** Identity-scale size of a target or layer: 1 wide, height from the aspect ratio (spec 6.1). */
    fun planeSize(pixelWidth: Double, pixelHeight: Double): Vec2 = Vec2(1.0, pixelHeight / pixelWidth)
}
