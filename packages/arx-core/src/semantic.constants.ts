export const SPEC_VERSION = "arx/0.1";
/** |norm(q) - 1| above this is invalid (same tolerance as OpenXR poses). */
export const QUATERNION_TOLERANCE = 0.01;
/** Authoring tools should flag drift above this. */
export const QUATERNION_AUTHORING_TOLERANCE = 1e-4;
