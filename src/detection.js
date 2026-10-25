// Pure drowsiness-indicator logic. No DOM or model code here, so it is testable.

export const DEFAULTS = {
  earThreshold: 0.30, // eyes count as "closed" below this smoothed EAR
  closureMs: 1500,    // closed this long continuously -> raise warning
  smoothing: 0.2,     // 0..0.9, weight of the previous value in the moving average
  reopenMs: 400,      // eyes must stay open this long to clear the warning
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Eye Aspect Ratio (Soukupova & Cech, 2016).
 * With the 6 eye landmarks p1..p6 (corner, top, top, corner, bottom, bottom):
 *   EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 * Open eyes sit around 0.25-0.35; the value drops towards 0 as the lid closes.
 * It varies with face shape, camera angle and glasses, hence the adjustable threshold.
 */
export function eyeAspectRatio(eye) {
  const vertical = dist(eye[1], eye[5]) + dist(eye[2], eye[4]);
  const horizontal = dist(eye[0], eye[3]);
  return horizontal > 0 ? vertical / (2 * horizontal) : 0;
}

/** Tracks closure over consecutive observations with smoothing and hysteresis. */
export class DrowsinessTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.smoothed = null;
    this.closedSince = null;
    this.openSince = null;
    this.warning = false;
  }

  /**
   * @param rawEar EAR for this observation, or null when no face was seen
   * @param now    timestamp in ms
   * @returns {{ear, closed, closedMs, warning, newWarning}}
   */
  update(rawEar, now, cfg = DEFAULTS) {
    // No face: nothing to judge. Clear state rather than guess; a missing
    // face is never treated as closed eyes.
    if (rawEar == null) {
      this.smoothed = this.closedSince = this.openSince = null;
      this.warning = false;
      return { ear: null, closed: false, closedMs: 0, warning: false, newWarning: false };
    }

    // Exponential moving average damps blinks and landmark jitter.
    this.smoothed =
      this.smoothed == null ? rawEar : this.smoothed * cfg.smoothing + rawEar * (1 - cfg.smoothing);

    const closed = this.smoothed < cfg.earThreshold;
    let closedMs = 0;
    let newWarning = false;

    if (closed) {
      this.openSince = null;
      this.closedSince ??= now;
      closedMs = now - this.closedSince;
      if (!this.warning && closedMs >= cfg.closureMs) {
        this.warning = true;
        newWarning = true;
      }
    } else {
      this.closedSince = null;
      this.openSince ??= now;
      // Hysteresis: require sustained open eyes before clearing.
      if (this.warning && now - this.openSince >= cfg.reopenMs) this.warning = false;
    }
    return { ear: this.smoothed, closed, closedMs, warning: this.warning, newWarning };
  }
}
