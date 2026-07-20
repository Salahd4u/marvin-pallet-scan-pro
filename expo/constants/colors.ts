/**
 * WindowCheck design tokens.
 * Dark industrial inspection theme: steel charcoal surfaces with high-visibility
 * safety amber accents. Green = normal/pass, Red = high-severity defect, Amber = low/medium.
 */

const palette = {
  amber: "#FF6B00",
  amberDim: "#C75500",
  amberSoft: "rgba(255,107,0,0.14)",
  green: "#22C55E",
  greenSoft: "rgba(34,197,94,0.16)",
  red: "#FF3B30",
  redSoft: "rgba(255,59,48,0.16)",
  blue: "#38BDF8",
};

const dark = {
  bg: "#0B0F14",
  bgElevated: "#11161D",
  surface: "#161D26",
  surfaceHigh: "#1E2733",
  border: "#26303C",
  borderStrong: "#374554",
  text: "#F2F6FA",
  textMuted: "#9AA8B8",
  textFaint: "#5E6E7E",
  tint: palette.amber,
  ...palette,
};

const Colors = {
  dark,
  // Keep a `light` key for template compatibility; the app is dark-only.
  light: {
    text: dark.text,
    background: dark.bg,
    tint: dark.tint,
    tabIconDefault: dark.textFaint,
    tabIconSelected: dark.tint,
  },
};

export default Colors;
export { palette };
