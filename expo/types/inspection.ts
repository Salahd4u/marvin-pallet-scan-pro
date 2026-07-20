/**
 * Core inspection domain types for window quality inspection.
 *
 * The AI vision model detects every visible window frame on the facade and
 * every defect on those frames (scratches, cracks, chips, dents, warping,
 * misalignment, discoloration, broken glass). Numbering, sorting, and stats
 * are deterministic post-processing steps performed locally.
 */

export type DefectType =
  | "scratch"
  | "crack"
  | "chip"
  | "dent"
  | "warp"
  | "misalign"
  | "discolor"
  | "break"
  | "other";

export type Severity = "low" | "medium" | "high";

/** A single detected defect on a window frame. */
export type Defect = {
  id: number;
  /** Defect category. */
  type: DefectType;
  /** Human-readable label for the defect type. */
  label: string;
  /** Severity assessed by the model. */
  severity: Severity;
  /** Bounding-box top-left X in source-image pixels. */
  x: number;
  /** Bounding-box top-left Y in source-image pixels. */
  y: number;
  width: number;
  height: number;
  /** Optional short description from the model. */
  note?: string;
};

/** A detected window frame (normal — no defects attached directly). */
export type WindowFrame = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Response from the AI window inspection engine. */
export type AnalyzeResponse = {
  /** Total number of window frames detected. */
  count: number;
  /** Average frame width in source-image pixels. */
  average_width: number;
  /** Average frame height in source-image pixels. */
  average_height: number;
  /** All detected defects across all frames. */
  defects: Defect[];
  /** Number of defects found. */
  defectCount: number;
  /** Overall confidence 0..100. */
  confidence: number;
  /** Annotated image as a data-URI (unused — overlay is rendered natively via SVG). */
  annotated_image_base64: string;
  /** Normal-frame boxes for overlay rendering. */
  items?: WindowFrame[];
  /** Source image pixel dimensions. */
  image_width?: number;
  image_height?: number;
};

/** A completed inspection, persisted for history. */
export type Inspection = {
  id: string;
  createdAt: number;
  imageUri: string;
  source: "on-device";
  result: AnalyzeResponse;
};

/** Human-readable label for a DefectType. */
export const DEFECT_LABELS: Record<DefectType, string> = {
  scratch: "Scratch",
  crack: "Crack",
  chip: "Chip / Flake",
  dent: "Dent",
  warp: "Warp / Bow",
  misalign: "Misalignment",
  discolor: "Discoloration",
  break: "Broken Glass",
  other: "Other Defect",
};

/** Short icon-friendly key for a DefectType (used for grouping). */
export const DEFECT_TYPE_KEY: Record<DefectType, string> = {
  scratch: "scratch",
  crack: "crack",
  chip: "chip",
  dent: "dent",
  warp: "warp",
  misalign: "misalign",
  discolor: "discolor",
  break: "break",
  other: "other",
};
