import type { Transform } from "./types";

/**
 * Reference basis changes from the ARX image frame (right-handed; +X right,
 * +Y image top, +Z out of the image) into platform image frames. Adapters
 * must reproduce these numbers; the conformance fixtures pin them.
 */

/**
 * AR Foundation ARTrackedImage local frame (Unity, left-handed): +X right,
 * +Y out of the image (normal), +Z toward the image top. The change of basis
 * P swaps Y and Z, so the node transform is P * M * P and the layer quad is
 * built in the node's XZ plane.
 */
export const toArFoundation = ({ position, rotation, scale }: Transform): Transform => ({
  position: [position[0], position[2], position[1]],
  rotation: [-rotation[0], -rotation[2], -rotation[1], rotation[3]],
  scale: [scale[0], scale[2], scale[1]],
});

/**
 * ARKit ARImageAnchor frame (right-handed): the same axes as ARCore, so the
 * same basis change applies. Confirmed on device in phase 1 item 3.
 */
export const toArKit = (transform: Transform): Transform => toArCore(transform);

/**
 * ARCore AugmentedImage center-pose frame (right-handed): +X right, +Y out
 * of the image, +Z toward the image bottom. C maps (x, y, z) to (x, z, -y);
 * it is a proper rotation, so the quaternion vector part maps the same way.
 */
export const toArCore = ({ position, rotation, scale }: Transform): Transform => ({
  position: [position[0], position[2], -position[1]],
  rotation: [rotation[0], rotation[2], -rotation[1], rotation[3]],
  scale: [scale[0], scale[2], scale[1]],
});
