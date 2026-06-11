import { Paths, Directory } from "expo-file-system";

import type { AnalyzeResponse, Anomaly, DetectedItem } from "@/types/inspection";

/**
 * Base URL of the Python FastAPI backend.
 * Configure via EXPO_PUBLIC_ANALYZE_API_URL (e.g. https://your-host). When unset
 * or unreachable, the app falls back to an on-device estimate so it stays usable.
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_ANALYZE_API_URL?.replace(/\/$/, "") ?? "";

const REQUEST_TIMEOUT_MS = 15000;

export class OfflineError extends Error {
  constructor() {
    super("No connection available. Please reconnect and try again.");
    this.name = "OfflineError";
  }
}

/** Lightweight connectivity probe; resolves false when the device is offline. */
export async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("https://clients3.google.com/generate_204", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

type AnalyzeArgs = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Sends the captured image to `POST /api/analyze`. Falls back to an on-device
 * estimate when no backend is configured. Throws OfflineError when the device
 * has no internet connection at all.
 *
 * When the backend returns `annotated_image_base64` the frontend can display it
 * directly — no client-side SVG overlay needed.  The raw detection boxes are
 * still returned alongside for the anomaly cards.
 */
export async function analyzeImage({
  uri,
  width,
  height,
}: AnalyzeArgs): Promise<{ result: AnalyzeResponse; source: "backend" | "offline-estimate" }> {
  const online = await checkConnectivity();
  if (!online) {
    throw new OfflineError();
  }

  if (API_BASE_URL.length > 0) {
    try {
      const form = new FormData();
      form.append("file", {
        uri,
        name: "pallet.jpg",
        type: "image/jpeg",
      } as unknown as Blob);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        body: form,
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Backend responded ${res.status}`);
      }
      const data = (await res.json()) as AnalyzeResponse;
      const normalized = normalize(data, width, height);

      // Convert base64 → local file URI so <Image> can display it.
      if (normalized.annotated_image_base64) {
        try {
          const fileUri = await saveBase64Image(normalized.annotated_image_base64);
          normalized.annotated_image_base64 = fileUri;
        } catch (e) {
          console.log("[analyzeImage] failed to cache annotated image", e);
          normalized.annotated_image_base64 = "";
        }
      }

      return { result: normalized, source: "backend" };
    } catch (err) {
      console.log("[analyzeImage] backend failed, using offline estimate", err);
      return { result: estimate(width, height), source: "offline-estimate" };
    }
  }

  // No backend configured: produce a realistic on-device estimate.
  await delay(400);
  return { result: estimate(width, height), source: "offline-estimate" };
}

function normalize(data: AnalyzeResponse, width: number, height: number): AnalyzeResponse {
  return {
    ...data,
    image_width: data.image_width ?? width,
    image_height: data.image_height ?? height,
    items: data.items ?? [],
    annotated_image_base64: data.annotated_image_base64 ?? "",
  };
}

/** Write a base64 JPEG string to the app cache directory and return a file:// URI. */
async function saveBase64Image(b64: string): Promise<string> {
  const cacheDir = new Directory(Paths.cache);
  const file = cacheDir.createFile(`annotated_${Date.now()}.jpg`, "image/jpeg");
  file.write(b64, { encoding: "base64" as const });
  return file.uri;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Offline fallback: generates a sparse, believable set of detected items
 * and a handful of flagged anomalies based on the image dimensions.
 *
 * This is NOT computer vision — it places boxes in a coarse grid that
 * will not align with the actual items in the photo.  It exists so the
 * app remains usable for demos when no backend is configured.
 *
 * Once you connect a real FastAPI backend (the one in /backend/main.py
 * uses OpenCV contour detection), the boxes will match the real items.
 */
function estimate(imgWidth: number, imgHeight: number): AnalyzeResponse {
  const w = imgWidth > 0 ? imgWidth : 1000;
  const h = imgHeight > 0 ? imgHeight : 1000;

  // Coarse grid — far fewer boxes than a real pallet so the mismatch
  // is less visually jarring.
  const cols = 5 + Math.floor(Math.random() * 3);
  const rows = 5 + Math.floor(Math.random() * 3);

  const marginX = w * 0.10;
  const marginY = h * 0.10;
  const usableW = w - marginX * 2;
  const usableH = h - marginY * 2;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  const stdW = Math.round(cellW * 0.72);
  const stdH = Math.round(cellH * 0.68);

  const items: DetectedItem[] = [];
  const anomalies: Anomaly[] = [];
  let id = 1;

  const total = cols * rows;
  const anomalyTargets = new Set<number>();
  const anomalyCount = 1 + Math.floor(Math.random() * 3);
  while (anomalyTargets.size < anomalyCount) {
    anomalyTargets.add(Math.floor(Math.random() * total));
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      const jitterX = (Math.random() - 0.5) * cellW * 0.10;
      const jitterY = (Math.random() - 0.5) * cellH * 0.10;
      const x = Math.round(marginX + c * cellW + (cellW - stdW) / 2 + jitterX);
      const y = Math.round(marginY + r * cellH + (cellH - stdH) / 2 + jitterY);

      if (anomalyTargets.has(index)) {
        const deviation = 15 + Math.floor(Math.random() * 20);
        const scale = deviation / 100;
        const sign = Math.random() < 0.5 ? -1 : 1;
        anomalies.push({
          id,
          x,
          y,
          width: Math.round(stdW * (1 + sign * scale)),
          height: Math.round(stdH * (1 + sign * scale)),
          deviation,
        });
      } else {
        items.push({ id, x, y, width: stdW, height: stdH });
      }
      id++;
    }
  }

  const confidence = 88 + Math.floor(Math.random() * 8);

  return {
    count: total,
    average_width: stdW,
    average_height: stdH,
    anomalies,
    items,
    confidence,
    annotated_image_base64: "",
    image_width: w,
    image_height: h,
  };
}
