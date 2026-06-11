import type { AnalyzeResponse } from "@/types/inspection";

/**
 * On-device AI detection engine — no backend, no cloud, no internet required.
 *
 * Uses a hidden WebView running a Canvas-based computer vision pipeline
 * for detecting wood pieces on pallets:
 *   Grayscale → Gaussian Blur → Adaptive Threshold →
 *   Contour Detection → Rectangle Filtering → Sort & Number →
 *   Size Analysis → Anomaly Detection
 *
 * To swap in a custom TensorFlow Lite model later, replace the WebView
 * processor HTML at assets/detection/processor.html with a TFLite-based
 * implementation — the rest of the app won't need changes.
 *
 * Re-exports from detectionService for backward compatibility.
 */
export { useDetectionEngine, detectOnDevice } from "./detectionService";
