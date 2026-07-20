/**
 * Core inspection domain types for window quality inspection.
 *
 * The AI vision model detects every visible window frame on the facade and
 * every defect on those frames (scratches, cracks, chips, dents, warping,
 * misalignment, discoloration, broken glass). Numbering, sorting, and stats
 * are deterministic post-processing steps performed locally.
 */

/**
 * Marvin window product types, sourced from https://www.marvin.com/products/windows.
 * Used to classify each detected window frame against the Marvin catalog.
 */
export type WindowType =
  | "awning"
  | "bay_bow"
  | "casement"
  | "corner"
  | "double_hung"
  | "glider"
  | "picture"
  | "single_hung"
  | "specialty"
  | "unknown";

/** Catalog entry for a Marvin window type. */
export type WindowTypeCatalogEntry = {
  id: WindowType;
  /** Marvin product name as shown on the site. */
  name: string;
  /** Short label shown on overlays. */
  short: string;
  /** Operating style / family. */
  style: string;
  /** Distinguishing visual cues used by the vision model. */
  visualCues: string;
  /** Marvin product page URL. */
  url: string;
};

/** Marvin window catalog used to match detected windows. */
export const WINDOW_TYPES: WindowTypeCatalogEntry[] = [
  {
    id: "awning",
    name: "Awning Windows",
    short: "Awning",
    style: "Top-hinged, projects outward",
    visualCues:
      "Single sash hinged at the top, swings outward, wider than tall, no central meeting rail.",
    url: "https://www.marvin.com/products/windows/awning-windows",
  },
  {
    id: "bay_bow",
    name: "Bay and Bow Windows",
    short: "Bay / Bow",
    style: "Multi-panel projection",
    visualCues:
      "Multiple windows angled outward from the wall forming a bay (3-panel angular) or bow (curved multi-panel) projection.",
    url: "https://www.marvin.com/products/windows/bay-and-bow-windows",
  },
  {
    id: "casement",
    name: "Casement Windows",
    short: "Casement",
    style: "Side-hinged, projects outward",
    visualCues:
      "Side-hinged sash swinging outward, visible side hinge, usually taller than wide, no horizontal meeting rail.",
    url: "https://www.marvin.com/products/windows/casement-windows",
  },
  {
    id: "corner",
    name: "Corner Windows",
    short: "Corner",
    style: "Meeting at a corner",
    visualCues:
      "Panels meeting at or wrapping a building corner with minimal framing to maximize glass at the corner.",
    url: "https://www.marvin.com/products/windows/corner-windows",
  },
  {
    id: "double_hung",
    name: "Double Hung Windows",
    short: "Double Hung",
    style: "Two vertically sliding sashes",
    visualCues:
      "Two operable sashes stacked vertically with a horizontal meeting rail in the middle; both top and bottom slide.",
    url: "https://www.marvin.com/products/windows/double-hung-windows",
  },
  {
    id: "glider",
    name: "Glider Windows",
    short: "Glider",
    style: "Horizontal sliding sash",
    visualCues:
      "Two or more sashes sliding horizontally past each other with a vertical meeting rail between them.",
    url: "https://www.marvin.com/products/windows/glider-windows",
  },
  {
    id: "picture",
    name: "Picture / Direct Glaze Windows",
    short: "Picture",
    style: "Fixed, non-operable",
    visualCues:
      "Large fixed glass with minimal frame, no operable sash, no meeting rail, maximizes view.",
    url: "https://www.marvin.com/products/windows/picture-windows",
  },
  {
    id: "single_hung",
    name: "Single Hung Windows",
    short: "Single Hung",
    style: "One vertically sliding sash",
    visualCues:
      "Two-sash window where only the bottom sash slides up; top sash is fixed; horizontal meeting rail in middle.",
    url: "https://www.marvin.com/products/windows/single-hung-windows",
  },
  {
    id: "specialty",
    name: "Specialty Shape Windows",
    short: "Specialty",
    style: "Non-rectangular / custom shape",
    visualCues:
      "Non-rectangular geometry: arched, round, triangular, octagonal, or other custom architectural shapes.",
    url: "https://www.marvin.com/products/windows/specialty-shape-windows",
  },
  {
    id: "unknown",
    name: "Unknown / Other",
    short: "Unknown",
    style: "Could not classify",
    visualCues: "Window does not clearly match any Marvin window category.",
    url: "https://www.marvin.com/products/windows",
  },
];

/** Lookup map from WindowType id to catalog entry. */
export const WINDOW_TYPE_MAP: Record<WindowType, WindowTypeCatalogEntry> =
  WINDOW_TYPES.reduce(
    (acc, entry) => {
      acc[entry.id] = entry;
      return acc;
    },
    {} as Record<WindowType, WindowTypeCatalogEntry>,
  );

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
  /** Matched Marvin window type. */
  windowType: WindowType;
  /** Model confidence in the window-type match (0..100). */
  typeConfidence?: number;
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
