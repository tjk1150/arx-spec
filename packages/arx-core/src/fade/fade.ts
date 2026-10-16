import { FADE_SECONDS } from "./fade.constants";

/**
 * Opacity of a layer surface `elapsedSeconds` after it was shown: linear from 0 to 1 over
 * FADE_SECONDS, clamped outside that range. The iOS FadeState and Android LayerFade run the same
 * vectors (fixtures/viewer/fade.json).
 */
export const fadeOpacity = (elapsedSeconds: number): number =>
  Math.min(1, Math.max(0, elapsedSeconds / FADE_SECONDS));
