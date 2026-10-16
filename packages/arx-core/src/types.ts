import type { ResolvedEffect } from "./effects/effects.types";

/** Lengths are in target-width units: 1.0 equals the target image width. */
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];
/** 4x4 matrix, column-major (glTF order). */
export type Mat4 = readonly number[];

export interface ManifestTransform {
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly scale?: Vec3;
}

export interface ImageAnchor {
  readonly type: "image";
  readonly src: string;
  /** Optional real-world width in meters; geometry never depends on it. */
  readonly physicalWidth?: number;
  readonly integrity?: string;
  readonly extensions?: Record<string, unknown>;
}

interface LayerBase {
  readonly id: string;
  readonly src: string;
  readonly integrity?: string;
  readonly transform?: ManifestTransform;
  readonly extensions?: Record<string, unknown>;
}

export interface ImageLayer extends LayerBase {
  readonly type: "image";
}

export interface VideoLayer extends LayerBase {
  readonly type: "video";
  readonly autoplay?: boolean;
  readonly loop?: boolean;
}

export type Layer = ImageLayer | VideoLayer;

/** A manifest as authored; optional fields may be absent. */
export interface Manifest {
  readonly spec: "arx/0.1";
  readonly id?: string;
  readonly title?: string;
  readonly anchor: ImageAnchor;
  readonly layers: readonly Layer[];
  readonly extensionsUsed?: readonly string[];
  readonly extensionsRequired?: readonly string[];
  readonly extensions?: Record<string, unknown>;
}

/** Transform with defaults applied and the rotation normalized. */
export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface Playback {
  readonly autoplay: boolean;
  readonly loop: boolean;
}

export interface ResolvedLayer {
  readonly id: string;
  readonly type: Layer["type"];
  /** Absolute URL of the asset after resolution against the manifest URL. */
  readonly url: string;
  readonly integrity?: string;
  readonly transform: Transform;
  readonly playback?: Playback;
}

export interface ResolvedManifest {
  readonly id?: string;
  readonly title?: string;
  readonly anchor: {
    readonly url: string;
    readonly physicalWidth?: number;
    readonly integrity?: string;
  };
  readonly layers: readonly ResolvedLayer[];
  /** ARX_effects effects that passed validation; empty when the extension is not read or absent. */
  readonly effects: readonly ResolvedEffect[];
  readonly extensionsUsed: readonly string[];
  readonly extensionsRequired: readonly string[];
}

export interface LayerGeometry extends ResolvedLayer {
  /** Identity-scale plane size in target-width units (width is always 1). */
  readonly size: Vec2;
  /** Media pixel size (width, height) after orientation. */
  readonly pixelSize: Vec2;
  /** Layer-to-anchor matrix in ARX canonical space, column-major. */
  readonly matrix: Mat4;
}

export interface Experience {
  readonly manifest: ResolvedManifest;
  readonly target: {
    readonly url: string;
    /** Always [1, height / width]. */
    readonly size: Vec2;
    readonly pixelSize: Vec2;
    /** Meters per unit when the author supplied it. */
    readonly physicalWidth?: number;
  };
  readonly layers: readonly LayerGeometry[];
}
