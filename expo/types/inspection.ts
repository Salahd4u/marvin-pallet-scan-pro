/**
 * Core inspection domain types.
 * All detection is performed on-device via the WebView Canvas processor.
 */

/** Anomalous wood piece (size deviation > 10% from average). */
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

/** Normal detected wood piece. */
export type DetectedItem = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Response from the on-device detection engine. */
export type AnalyzeResponse = {
  count: number;
  average_width: number;
  average_height: number;
  anomalies: Anomaly[];
  confidence: number;
  /** Annotated image as a data-URI JPEG (base64). */
  annotated_image_base64: string;
  /** Normal-item boxes for overlay rendering. */
  items?: DetectedItem[];
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
