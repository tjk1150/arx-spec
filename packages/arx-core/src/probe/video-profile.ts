import { error, warning, type Issue } from "../issues";
import type { Mp4Probe } from "./mp4";
import { AAC_LC, BASELINE, H264_CODECS, HIGH, MAIN, MPEG4_AUDIO, PORTABLE_VIDEO } from "./video-profile.constants";

export { PORTABLE_VIDEO } from "./video-profile.constants";

/**
 * Checks a probed MP4 against the Portable Video Profile. Codec failures are
 * errors; other deviations are warnings unless `strict` is set.
 */
export const checkVideoProfile = (probe: Mp4Probe, pointer: string, strict = false): Issue[] => {
  const issues: Issue[] = [];
  const deviation = (code: Parameters<typeof warning>[0], message: string) =>
    issues.push(strict ? { ...warning(code, pointer, message), severity: "error" } : warning(code, pointer, message));

  const { video, audio } = probe;
  if (!video) {
    issues.push(error("ARX_ASSET_DECODE", pointer, "MP4 has no video track"));
    return issues;
  }
  if (!H264_CODECS.has(video.codec)) {
    issues.push(error("ARX_VIDEO_CODEC", pointer, `video codec ${video.codec} is not H.264`));
    return issues;
  }
  const profile = video.avcProfile;
  if (profile !== undefined && profile > HIGH) {
    issues.push(error("ARX_VIDEO_PIXEL_FORMAT", pointer, `H.264 profile ${profile} is not 8-bit 4:2:0`));
  } else if (profile !== undefined && profile !== BASELINE && profile !== MAIN) {
    deviation("ARX_VIDEO_PROFILE", `H.264 profile ${profile}; Main or Baseline is portable`);
  }
  if (video.avcLevel !== undefined && video.avcLevel > PORTABLE_VIDEO.maxLevel) {
    deviation("ARX_VIDEO_PROFILE", `H.264 level ${video.avcLevel / 10} exceeds 4.1`);
  }
  const longSide = Math.max(video.width, video.height);
  const shortSide = Math.min(video.width, video.height);
  if (longSide > PORTABLE_VIDEO.maxLongSide || shortSide > PORTABLE_VIDEO.maxShortSide) {
    deviation("ARX_VIDEO_RESOLUTION", `${video.width}x${video.height} exceeds 1920x1080`);
  }
  if (video.frameRate !== undefined && video.frameRate > PORTABLE_VIDEO.maxFrameRate + 0.5) {
    deviation("ARX_VIDEO_FRAME_RATE", `${video.frameRate.toFixed(2)} fps exceeds 30`);
  }
  if (probe.bitrate !== undefined && probe.bitrate > PORTABLE_VIDEO.maxBitrate) {
    deviation("ARX_VIDEO_BITRATE", `${(probe.bitrate / 1e6).toFixed(1)} Mbps exceeds 8 Mbps`);
  }
  if (!video.identityMatrix) {
    deviation("ARX_VIDEO_ROTATION", "track has rotation metadata; bake it into the pixels");
  }
  if (!probe.faststart) {
    deviation("ARX_VIDEO_NOT_FASTSTART", "moov box is after mdat; encode with -movflags +faststart");
  }
  if (audio) {
    const isAacLc =
      audio.codec === "mp4a" && audio.objectType === MPEG4_AUDIO && audio.audioObjectType === AAC_LC;
    if (!isAacLc) {
      issues.push(error("ARX_AUDIO_CODEC", pointer, `audio track ${audio.codec} is not AAC-LC`));
    }
  }
  return issues;
};
