package dev.arx.core

import org.junit.jupiter.api.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Ports math.test.ts: TRS order and the platform basis changes as matrix identities. */
class GeometryTest {
    private val half = sqrt(0.5)

    private fun multiply(left: DoubleArray, right: DoubleArray) = DoubleArray(16) { cell ->
        val column = cell / 4
        val row = cell % 4
        (0 until 4).sumOf { inner -> left[inner * 4 + row] * right[column * 4 + inner] }
    }

    /** Column-major basis matrix from the images of the ARX unit axes. */
    private fun basis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3) =
        xAxis.array + 0.0 + yAxis.array + 0.0 + zAxis.array + 0.0 + doubleArrayOf(0.0, 0.0, 0.0, 1.0)

    // ARX (x, y, z) -> AR Foundation tracked image (x, z, y); a reflection.
    private val arFoundation = basis(Vec3(1.0, 0.0, 0.0), Vec3(0.0, 0.0, 1.0), Vec3(0.0, 1.0, 0.0))

    // ARX (x, y, z) -> ARCore augmented image (x, z, -y); a proper rotation.
    private val arCore = basis(Vec3(1.0, 0.0, 0.0), Vec3(0.0, 0.0, -1.0), Vec3(0.0, 1.0, 0.0))
    private val arCoreInverse = basis(Vec3(1.0, 0.0, 0.0), Vec3(0.0, 0.0, 1.0), Vec3(0.0, -1.0, 0.0))

    private fun assertMatrix(expected: DoubleArray, actual: DoubleArray) {
        expected.indices.forEach { assertTrue(abs(expected[it] - actual[it]) < 1e-9, "[$it] ${expected[it]} vs ${actual[it]}") }
    }

    private fun transformPoint(matrix: DoubleArray, point: Vec3) = Vec3(
        matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
        matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
        matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
    )

    private fun randomTransforms(): List<ArxTransform> {
        var seed = 42L
        fun random(): Double {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296.0
        }
        return List(50) {
            val axis = Vec3(random() - 0.5, random() - 0.5, random() - 0.5)
            val length = sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z)
            val angle = random() * PI * 2
            val sine = sin(angle / 2)
            ArxTransform(
                position = Vec3(random() - 0.5, random() - 0.5, random() * 0.1),
                rotation = Quat(axis.x / length * sine, axis.y / length * sine, axis.z / length * sine, cos(angle / 2)),
                scale = Vec3(0.1 + random(), 0.1 + random(), 0.1 + random()),
            )
        }
    }

    @Test
    fun appliesScaleThenRotationThenTranslation() {
        val matrix = ArxTransform(Vec3(0.1, 0.2, 0.3), Quat(0.0, 0.0, half, half), Vec3(0.5, 0.25, 1.0)).matrix
        // (1, 0, 0) -> scale (0.5, 0, 0) -> rotate +90 about Z (0, 0.5, 0) -> translate.
        val point = transformPoint(matrix, Vec3(1.0, 0.0, 0.0))
        assertTrue(abs(point.x - 0.1) < 1e-12 && abs(point.y - 0.7) < 1e-12 && abs(point.z - 0.3) < 1e-12, "$point")
    }

    @Test
    fun defaultTransformIsIdentity() {
        val identity = DoubleArray(16) { if (it % 5 == 0) 1.0 else 0.0 }
        assertMatrix(identity, ArxTransform.from(null).matrix)
        assertEquals(ArxTransform.IDENTITY, ArxTransform.from(null))
    }

    @Test
    fun planeSizeKeepsTheMediaAspectRatio() {
        assertEquals(Vec2(1.0, 0.5625), Geometry.planeSize(1920.0, 1080.0))
        assertEquals(Vec2(1.0, 4.0 / 3.0), Geometry.planeSize(300.0, 400.0))
    }

    @Test
    fun arFoundationTransformEqualsPMP() {
        for (transform in randomTransforms()) {
            val expected = multiply(multiply(arFoundation, transform.matrix), arFoundation)
            assertMatrix(expected, ArFoundationBasis.transform(transform).matrix)
        }
    }

    @Test
    fun arCoreTransformEqualsCMCInverse() {
        for (transform in randomTransforms()) {
            val expected = multiply(multiply(arCore, transform.matrix), arCoreInverse)
            assertMatrix(expected, ArCoreBasis.transform(transform).matrix)
        }
    }

    @Test
    fun mapsTheArxImageAxesOntoEachPlatformsImageAxes() {
        val identity = ArxTransform(Vec3(0.1, 0.2, 0.3), Quat.IDENTITY, Vec3.ONE)
        // Right stays X; image-up is +Z in AR Foundation and -Z in ARCore; out is +Y in both.
        assertEquals(Vec3(0.1, 0.3, 0.2), ArFoundationBasis.transform(identity).position)
        assertEquals(Vec3(0.1, 0.3, -0.2), ArCoreBasis.transform(identity).position)
    }
}
