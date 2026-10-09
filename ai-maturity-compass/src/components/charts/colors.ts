/**
 * Chart palette. Series colours are the validated categorical slots 1–3 (blue, orange, aqua).
 * Scores 0–4 use a one-hue sequential blue ramp (light → dark); text colour flips for contrast.
 */
export const COLORS = {
  verified: '#2a78d6',
  self: '#eb6834',
  bench: '#1baf7a',
  grid: '#DDE4EC',
  axis: '#52627A',
  ink: '#0B1F3A',
  critical: '#d03b3b',
} as const;

export const SCORE_FILL = ['#cde2fb', '#9ec5f4', '#5598e7', '#256abf', '#104281'] as const;
export const SCORE_TEXT = ['#0B1F3A', '#0B1F3A', '#0B1F3A', '#ffffff', '#ffffff'] as const;
