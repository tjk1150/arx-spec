export interface VideoTrack {
  /** Sample entry four-character code, e.g. avc1. */
  readonly codec: string;
  /** Display size from the track header. */
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  /** True when the stts sample deltas differ; false when they are all equal. Unset without a sample table. */
  readonly variableFrameRate?: boolean;
  /** Average bitrate of this track alone in bits per second (stsz total over the track duration). */
  readonly bitrate?: number;
  /** H.264 profile_idc and level_idc from avcC. */
  readonly avcProfile?: number;
  readonly avcLevel?: number;
  /** False when the track matrix rotates or mirrors the picture. */
  readonly identityMatrix: boolean;
  /** colr nclx tags (ISO/IEC 23091-2 code points); unset when the entry has no nclx colr box. */
  readonly colorPrimaries?: number;
  /** Transfer characteristics: 16 = PQ (SMPTE ST 2084), 18 = HLG (ARIB STD-B67). */
  readonly transferCharacteristics?: number;
  readonly matrixCoefficients?: number;
  readonly fullRange?: boolean;
}

export interface AudioTrack {
  readonly codec: string;
  /** MPEG-4 objectTypeIndication from esds (0x40 = MPEG-4 audio). */
  readonly objectType?: number;
  /** AudioSpecificConfig audioObjectType (2 = AAC-LC). */
  readonly audioObjectType?: number;
  /** Channel count and sample rate (Hz) from the sample entry. */
  readonly channelCount?: number;
  readonly sampleRate?: number;
  /** avgBitrate from esds in bits per second; unset when esds is missing or stores 0. */
  readonly bitrate?: number;
}

export interface Mp4Probe {
  readonly faststart: boolean;
  readonly durationSeconds?: number;
  readonly bitrate?: number;
  readonly video?: VideoTrack;
  readonly audio?: AudioTrack;
}

export interface Box {
  readonly type: string;
  /** Start of the payload (after the header). */
  readonly start: number;
  readonly end: number;
}
