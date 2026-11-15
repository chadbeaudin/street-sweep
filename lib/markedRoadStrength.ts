// Heavy soft penalty for user-marked avoided roads: much larger than the
// isAvoided category penalty (50x) so a manually-marked street is a last
// resort, but still not a hard exclude -- a route that has no other way in
// can still use it.
export const DEFAULT_AVOID_STRENGTH = 100;

// Preferred roads cost 1/strength of their length, so by default a route takes one
// over an alternative up to 2.5x longer (#46).
export const DEFAULT_PREFER_STRENGTH = 2.5;
