export interface ImageProbe {
  readonly format: "png" | "jpeg";
  /** Stored pixel size. */
  readonly width: number;
  readonly height: number;
  /** EXIF orientation (1-8); 1 when absent. */
  readonly orientation: number;
  readonly hasAlpha: boolean;
}
