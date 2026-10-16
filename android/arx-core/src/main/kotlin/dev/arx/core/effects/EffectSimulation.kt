package dev.arx.core.effects

import dev.arx.core.ArxTransform
import dev.arx.core.Vec3
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A read-only view of one live particle. Position is in content-root space (target-width units),
 * color channels are sRGB 0..1. A view reads the simulation's buffer, so its values change on the
 * next [EffectSimulation.advance]; copy them to keep them.
 */
interface ParticleView {
    /** Birth number, 0 for the first particle the effect emits. */
    val index: Long
    val x: Double
    val y: Double
    val z: Double
    val size: Double
    val angleDegrees: Double
    val red: Double
    val green: Double
    val blue: Double
    val alpha: Double
}

/**
 * The deterministic particle simulation of one effect (spec/extensions/ARX_effects.md section 7),
 * ported from packages/arx-core/src/effects/simulate.ts and checked against the same vectors
 * (fixtures/effects/simulation.json). Each [advance] recomputes the live particles from their
 * birth times, so equal effect times give equal particles whatever the frame cadence. Particle
 * state lives in fixed arrays overwritten in place (an exception to immutable updates, so a frame
 * allocates nothing); [particles] returns read-only views over them, oldest first, at most
 * [MAX_PARTICLES], and [copyState] copies them in one step for a renderer. [restart] empties them
 * for a clock that starts again at 0 (spec 7.1).
 *
 * What a particle draws at birth (spec 7.4: lifetime, start point, velocity, size, first angle,
 * angular speed) depends only on its birth number, so it is computed once and kept in a small cache
 * keyed by that number; each frame then only moves the particle to its age (spec 7.5). The cache
 * holds the same values a fresh computation gives, bit for bit, so it never changes a result.
 * Throws an IllegalArgumentException for a preset and amount that never
 * emit, a burst with no period, or an unknown alpha curve.
 */
class EffectSimulation(effect: ArxEffect, private val preset: ArxEffectPreset) {
    companion object {
        /** Most live particles per effect; equals EFFECT_LIMITS.maxParticles of the TypeScript core. */
        const val MAX_PARTICLES = 256

        /**
         * Draws per particle in birth order: region x, y, z, cone cos(phi), cone alpha, speed,
         * lifetime, size, first angle, angular speed (spec 7.4).
         */
        private const val DRAWS_PER_PARTICLE = 10

        /** Doubles per particle in the live state: x, y, z, size, angleDegrees, red, green, blue, alpha. */
        const val STATE_STRIDE = 9

        /**
         * Birth numbers the birth cache holds, a power of two: more than the births one frame visits for
         * the bundled presets at amount 4 (snow: 6 s x 40 per second). A wider span only recomputes.
         */
        private const val BIRTH_SLOTS = 512
        private const val BIRTH_MASK = BIRTH_SLOTS - 1L

        /** Cached doubles per birth: lifetime, start x, y, z, velocity x, y, z, size, first angle, angular speed. */
        private const val BIRTH_STRIDE = 10
        private const val NO_BIRTH = -1L

        /** `#RRGGBB` as sRGB channels 0..1. */
        private fun channels(color: String): DoubleArray = doubleArrayOf(
            color.substring(1, 3).toInt(16) / 255.0,
            color.substring(3, 5).toInt(16) / 255.0,
            color.substring(5, 7).toInt(16) / 255.0,
        )

        private fun lerp(from: Double, to: Double, share: Double): Double = from + (to - from) * share

        private fun cross(left: Vec3, right: Vec3): Vec3 = Vec3(
            left.y * right.z - left.z * right.y,
            left.z * right.x - left.x * right.z,
            left.x * right.y - left.y * right.x,
        )

        private fun normalize(vector: Vec3): Vec3 {
            val length = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
            return Vec3(vector.x / length, vector.y / length, vector.z / length)
        }

        /** A column-major matrix applied to a point. */
        private fun transformPoint(matrix: DoubleArray, x: Double, y: Double, z: Double): Vec3 = Vec3(
            matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
            matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
            matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
        )
    }

    private val perSecond = preset.rate * effect.amount
    private val emission = preset.emission
    private val period: Double
    private val perWindow: Long
    private val longestLife = max(preset.lifetime.x, preset.lifetime.y)
    private val seed = EffectRandom.fnv1a32(effect.id)
    private val matrix = effect.matrix
    private val speedScale = effect.speed
    private val sizeScale = effect.size
    private val rotation = ArxTransform(Vec3.ZERO, effect.transform.rotation, Vec3.ONE).matrix
    private val gravity = transformPoint(rotation, preset.acceleration.x, preset.acceleration.y, preset.acceleration.z)
    private val axis = preset.direction
    private val sideAxis: Vec3
    private val upAxis: Vec3
    private val spreadCos = cos(preset.spreadDegrees * (PI / 180))
    private val birthColor = channels(effect.colors[0])
    private val deathColor = channels(effect.colors[1])
    private val endSizeScale = preset.endSizeScale
    private val alphaCurve = preset.alphaCurve

    private val indexes = LongArray(MAX_PARTICLES)
    private val buffer = DoubleArray(MAX_PARTICLES * STATE_STRIDE)
    private var count = 0

    /** Birth number held in each birth cache slot, [NO_BIRTH] when empty. */
    private val cachedBirths = LongArray(BIRTH_SLOTS) { NO_BIRTH }
    private val births = DoubleArray(BIRTH_SLOTS * BIRTH_STRIDE)

    /** One view per buffer slot, created once. */
    private val views: List<ParticleView> = List(MAX_PARTICLES) { slot -> SlotView(slot) }

    /** The live views, a fixed read-only list whose size follows [count]. */
    private val live: List<ParticleView> = object : AbstractList<ParticleView>() {
        override val size: Int get() = count

        override fun get(index: Int): ParticleView {
            if (index !in 0 until count) throw IndexOutOfBoundsException("index $index, size $count")
            return views[index]
        }
    }

    init {
        require(perSecond.isFinite() && perSecond > 0) { "EffectSimulation: ${effect.id} emits $perSecond particles per second" }
        period = when (emission) {
            is ArxEffectEmission.Burst -> emission.emitSeconds + emission.pauseSeconds
            ArxEffectEmission.Continuous -> 0.0
        }
        require(emission !is ArxEffectEmission.Burst || period > 0) { "EffectSimulation: ${effect.id} has a burst period of $period s" }
        require(preset.alphaCurve in AlphaCurves.NAMES) { "EffectSimulation: unknown alpha curve ${preset.alphaCurve}" }
        // Burst window size N = max(1, round half away from zero of emitSeconds * n) (spec 7.3).
        perWindow = when (emission) {
            is ArxEffectEmission.Burst -> max(1L, floor(emission.emitSeconds * perSecond + 0.5).toLong())
            ArxEffectEmission.Continuous -> 0L
        }
        // e1, e2 around the cone axis (spec 7.4): the helper is +Y unless the axis is near it, then +Z.
        val helper = if (abs(axis.y) < 0.9) Vec3(0.0, 1.0, 0.0) else Vec3(0.0, 0.0, 1.0)
        sideAxis = normalize(cross(helper, axis))
        upAxis = cross(axis, sideAxis)
    }

    /** Recomputes the live particles at effect time [timeSeconds]. Throws for a time that is not finite. */
    fun advance(timeSeconds: Double) {
        require(timeSeconds.isFinite()) { "EffectSimulation: effect time $timeSeconds is not a finite number" }
        count = 0
        if (emission is ArxEffectEmission.Burst) collectBursts(timeSeconds) else collectContinuous(timeSeconds)
    }

    /**
     * Empties the live particles for an effect clock that starts again at 0 (spec 7.1: the target is
     * tracked again). The next [advance] then gives the particles of a new simulation at that time.
     */
    fun restart() {
        count = 0
    }

    /** The live particles of the last [advance] in birth order; empty before the first. */
    fun particles(): List<ParticleView> = live

    /**
     * Copies the live particles of the last [advance], in birth order, into [into]: [STATE_STRIDE]
     * doubles each (x, y, z, size, angleDegrees, red, green, blue, alpha, as [particles] reads them).
     * Returns how many. Throws an IllegalArgumentException when [into] holds fewer than that many.
     */
    fun copyState(into: DoubleArray): Int {
        require(into.size >= count * STATE_STRIDE) { "EffectSimulation: ${into.size} doubles hold fewer than $count particles" }
        System.arraycopy(buffer, 0, into, 0, count * STATE_STRIDE)
        return count
    }

    private fun draw(index: Long, which: Int): Double =
        EffectRandom.mulberry32At(seed, index * DRAWS_PER_PARTICLE + which)

    /** Writes particle [index] at [birth] into the next slot when it is alive; returns whether a slot is left. */
    private fun visit(index: Long, birth: Double, time: Double): Boolean {
        if (writeParticle(count, index, birth, time)) count += 1
        return count < MAX_PARTICLES
    }

    private fun collectContinuous(time: Double) {
        // Start one birth early so rounding in the estimate never skips a live particle.
        var index = max(0.0, floor((time - longestLife) * perSecond) - 1).toLong()
        while (index / perSecond <= time) {
            if (!visit(index, index / perSecond, time)) return
            index += 1
        }
    }

    private fun collectBursts(time: Double) {
        val lastOffset = (perWindow - 1) / perSecond
        var window = max(0.0, floor((time - longestLife - lastOffset) / period) - 1).toLong()
        while (window * period <= time) {
            for (slotInWindow in 0L until perWindow) {
                val birth = window * period + slotInWindow / perSecond
                if (!visit(window * perWindow + slotInWindow, birth, time)) return
            }
            window += 1
        }
    }

    /** Writes particle [index] into [slot] when it is alive at [time] (spec 7.4, 7.5); returns whether it was. */
    private fun writeParticle(slot: Int, index: Long, birth: Double, time: Double): Boolean {
        val born = birthOffset(index)
        val lifetime = births[born]
        if (!(birth <= time && time < birth + lifetime)) return false
        val age = time - birth
        val life = age / lifetime
        val base = slot * STATE_STRIDE
        indexes[slot] = index
        buffer[base] = births[born + 1] + births[born + 4] * age + 0.5 * gravity.x * age * age
        buffer[base + 1] = births[born + 2] + births[born + 5] * age + 0.5 * gravity.y * age * age
        buffer[base + 2] = births[born + 3] + births[born + 6] * age + 0.5 * gravity.z * age * age
        buffer[base + 3] = births[born + 7] * (1 + (endSizeScale - 1) * life)
        buffer[base + 4] = births[born + 8] + births[born + 9] * age
        buffer[base + 5] = birthColor[0] + (deathColor[0] - birthColor[0]) * life
        buffer[base + 6] = birthColor[1] + (deathColor[1] - birthColor[1]) * life
        buffer[base + 7] = birthColor[2] + (deathColor[2] - birthColor[2]) * life
        buffer[base + 8] = AlphaCurves.alpha(alphaCurve, life)
        return true
    }

    /** Offset of particle [index]'s birth values in [births], computing them on a cache miss. */
    private fun birthOffset(index: Long): Int {
        val slot = (index and BIRTH_MASK).toInt()
        val offset = slot * BIRTH_STRIDE
        if (cachedBirths[slot] != index) {
            writeBirth(offset, index)
            cachedBirths[slot] = index
        }
        return offset
    }

    /**
     * Writes the values particle [index] draws at birth (spec 7.4) at [offset] in [births]. The
     * arithmetic follows the TypeScript reference term by term, so the cached values equal the ones
     * it computes each frame: velocity is speed x turned direction, later multiplied by the age.
     */
    private fun writeBirth(offset: Int, index: Long) {
        val regionX = preset.shapeSize.x * (2 * draw(index, 0) - 1)
        val regionY = preset.shapeSize.y * (2 * draw(index, 1) - 1)
        val regionZ = preset.shapeSize.z * (2 * draw(index, 2) - 1)
        val cosPhi = 1 - draw(index, 3) * (1 - spreadCos)
        val alpha = 2 * PI * draw(index, 4)
        val speed = preset.speed * speedScale * (1 + preset.speedVariation * (2 * draw(index, 5) - 1))
        val lifetime = lerp(preset.lifetime.x, preset.lifetime.y, draw(index, 6))
        val size = sizeScale * (1 + preset.sizeVariation * (2 * draw(index, 7) - 1))
        val angle = lerp(preset.angleDegrees.x, preset.angleDegrees.y, draw(index, 8))
        val spin = lerp(preset.angularSpeedDegrees.x, preset.angularSpeedDegrees.y, draw(index, 9))
        val sinPhi = sqrt(max(0.0, 1 - cosPhi * cosPhi))
        val across = sinPhi * cos(alpha)
        val around = sinPhi * sin(alpha)
        val localX = across * sideAxis.x + around * upAxis.x + cosPhi * axis.x
        val localY = across * sideAxis.y + around * upAxis.y + cosPhi * axis.y
        val localZ = across * sideAxis.z + around * upAxis.z + cosPhi * axis.z
        births[offset] = lifetime
        births[offset + 1] = matrix[0] * regionX + matrix[4] * regionY + matrix[8] * regionZ + matrix[12]
        births[offset + 2] = matrix[1] * regionX + matrix[5] * regionY + matrix[9] * regionZ + matrix[13]
        births[offset + 3] = matrix[2] * regionX + matrix[6] * regionY + matrix[10] * regionZ + matrix[14]
        births[offset + 4] = speed * (rotation[0] * localX + rotation[4] * localY + rotation[8] * localZ + rotation[12])
        births[offset + 5] = speed * (rotation[1] * localX + rotation[5] * localY + rotation[9] * localZ + rotation[13])
        births[offset + 6] = speed * (rotation[2] * localX + rotation[6] * localY + rotation[10] * localZ + rotation[14])
        births[offset + 7] = size
        births[offset + 8] = angle
        births[offset + 9] = spin
    }

    /** Reads one buffer slot. */
    private inner class SlotView(slot: Int) : ParticleView {
        private val base = slot * STATE_STRIDE
        private val at = slot

        override val index: Long get() = indexes[at]
        override val x: Double get() = buffer[base]
        override val y: Double get() = buffer[base + 1]
        override val z: Double get() = buffer[base + 2]
        override val size: Double get() = buffer[base + 3]
        override val angleDegrees: Double get() = buffer[base + 4]
        override val red: Double get() = buffer[base + 5]
        override val green: Double get() = buffer[base + 6]
        override val blue: Double get() = buffer[base + 7]
        override val alpha: Double get() = buffer[base + 8]
    }
}
