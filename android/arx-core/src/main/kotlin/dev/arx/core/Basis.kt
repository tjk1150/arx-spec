package dev.arx.core

/**
 * ARCore AugmentedImage center-pose frame (spec 11.2, right-handed): +X right,
 * +Y out of the image, +Z toward the image bottom. C maps (x, y, z) to (x, z, -y);
 * it is a proper rotation, so the quaternion vector part maps the same way.
 * Android XR image trackables and ARKit image anchors use the same axes.
 */
object ArCoreBasis {
    fun position(value: Vec3): Vec3 = Vec3(value.x, value.z, -value.y)

    fun rotation(value: Quat): Quat = Quat(value.x, value.z, -value.y, value.w)

    fun scale(value: Vec3): Vec3 = Vec3(value.x, value.z, value.y)

    /** The layer transform whose TRS matrix equals C * M * C^-1. */
    fun transform(value: ArxTransform): ArxTransform =
        ArxTransform(position(value.position), rotation(value.rotation), scale(value.scale))
}

/**
 * AR Foundation ARTrackedImage local frame (spec 11.1, Unity, left-handed): +X right,
 * +Y out of the image, +Z toward the image top. P swaps Y and Z, so the node
 * transform is P * M * P and the layer quad lies in the node's XZ plane.
 */
object ArFoundationBasis {
    fun position(value: Vec3): Vec3 = Vec3(value.x, value.z, value.y)

    fun rotation(value: Quat): Quat = Quat(-value.x, -value.z, -value.y, value.w)

    fun scale(value: Vec3): Vec3 = Vec3(value.x, value.z, value.y)

    fun transform(value: ArxTransform): ArxTransform =
        ArxTransform(position(value.position), rotation(value.rotation), scale(value.scale))
}
