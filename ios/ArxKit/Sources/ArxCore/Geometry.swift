/// Lengths are in target-width units: 1.0 equals the target image width (spec 3.1).
public struct Vec2: Sendable, Equatable, Codable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
    public var array: [Double] { [x, y] }
}

public struct Vec3: Sendable, Equatable, Codable {
    public let x: Double
    public let y: Double
    public let z: Double

    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
    public var array: [Double] { [x, y, z] }
}

/// Unit quaternion [x, y, z, w], right-handed.
public struct Quat: Sendable, Equatable, Codable {
    public let x: Double
    public let y: Double
    public let z: Double
    public let w: Double

    public init(x: Double, y: Double, z: Double, w: Double) {
        self.x = x
        self.y = y
        self.z = z
        self.w = w
    }

    public static let identity = Quat(x: 0, y: 0, z: 0, w: 1)

    public var norm: Double { (x * x + y * y + z * z + w * w).squareRoot() }

    public var normalized: Quat {
        let length = norm
        return Quat(x: x / length, y: y / length, z: z / length, w: w / length)
    }
}

/// A layer transform with defaults applied and the rotation normalized.
public struct ArxTransform: Sendable, Equatable, Codable {
    public let position: Vec3
    public let rotation: Quat
    public let scale: Vec3

    public init(position: Vec3, rotation: Quat, scale: Vec3) {
        self.position = position
        self.rotation = rotation
        self.scale = scale
    }

    public init(_ input: ArxManifest.TransformInput?) {
        let position = input?.position ?? [0, 0, 0]
        let rotation = input?.rotation ?? [0, 0, 0, 1]
        let scale = input?.scale ?? [1, 1, 1]
        self.init(
            position: Vec3(x: position[0], y: position[1], z: position[2]),
            rotation: Quat(x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3]).normalized,
            scale: Vec3(x: scale[0], y: scale[1], z: scale[2])
        )
    }

    /// M = T * R * S, column-major (glTF order).
    public var matrix: [Double] {
        let (qx, qy, qz, qw) = (rotation.x, rotation.y, rotation.z, rotation.w)
        let (sx, sy, sz) = (scale.x, scale.y, scale.z)
        return [
            (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
            2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
            2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
            position.x, position.y, position.z, 1,
        ]
    }
}

public enum Geometry {
    /// Identity-scale size of a target or layer: 1 wide, height from the aspect ratio (spec 6.1).
    public static func planeSize(pixelWidth: Double, pixelHeight: Double) -> Vec2 {
        Vec2(x: 1, y: pixelHeight / pixelWidth)
    }
}
