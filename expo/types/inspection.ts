/**
 * Core inspection domain types.
 * Shapes mirror the FastAPI `POST /api/analyze` response.
 */

export type Anomaly = {
  id: number;
  /** Bounding-box top-left X in source-image pixels. */
  x: number;
  /** Bounding-box top-left Y in source-image pixels. */
  y: number;
  width: number;
  height: number;
  /** Percentage deviation from the standard item size. */
  deviation: number;
};

/** Normal item box used to draw green outlines on the annotated image. */
export type DetectedItem = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Raw API response from `POST /api/analyze`. */
export type AnalyzeResponse = {
  count: number;
  average_width: number;
  average_height: number;
  anomalies: Anomaly[];
  confidence: number;
  /** Backend-annotated image as a base64-encoded JPEG string (no data-URI prefix). */
  annotated_image_base64: string;
  /** Optional normal-item boxes (extension over the base contract). */
  items?: DetectedItem[];
  /** Source image pixel dimensions used for overlay scaling. */
  image_width?: number;
  image_height?: number;
};

/** A completed inspection, persisted for history. */
export type Inspection = {
  id: string;
  createdAt: number;
  imageUri: string;
  source: "backend";
  result: AnalyzeResponse;
};
