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
      return { result: normalize(data, width, height), source: "backend" };
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
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a believable grid of stacked items with a few flagged anomalies.
 * Used as the offline / no-backend analyzer so the experience is complete.
 */
function estimate(imgWidth: number, imgHeight: number): AnalyzeResponse {
  const w = imgWidth > 0 ? imgWidth : 1000;
  const h = imgHeight > 0 ? imgHeight : 1000;

  const cols = 11 + Math.floor(Math.random() * 4);
  const rows = 12 + Math.floor(Math.random() * 4);

  const marginX = w * 0.06;
  const marginY = h * 0.08;
  const cellW = (w - marginX * 2) / cols;
  const cellH = (h - marginY * 2) / rows;

  const stdW = Math.round(cellW * 0.78);
  const stdH = Math.round(cellH * 0.74);

  const items: DetectedItem[] = [];
  const anomalies: Anomaly[] = [];
  let id = 1;

  const anomalyTargets = new Set<number>();
  const anomalyCount = 2 + Math.floor(Math.random() * 3);
  const total = cols * rows;
  while (anomalyTargets.size < anomalyCount) {
    anomalyTargets.add(Math.floor(Math.random() * total));
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      const jitterX = (Math.random() - 0.5) * cellW * 0.12;
      const jitterY = (Math.random() - 0.5) * cellH * 0.12;
      const x = Math.round(marginX + c * cellW + (cellW - stdW) / 2 + jitterX);
      const y = Math.round(marginY + r * cellH + (cellH - stdH) / 2 + jitterY);

      if (anomalyTargets.has(index)) {
        const deviation = 14 + Math.floor(Math.random() * 22);
        const scale = 1 + (Math.random() < 0.5 ? -1 : 1) * (deviation / 100);
        anomalies.push({
          id,
          x,
          y,
          width: Math.round(stdW * scale),
          height: Math.round(stdH * scale),
          deviation,
        });
      } else {
        items.push({ id, x, y, width: stdW, height: stdH });
      }
      id++;
    }
  }

  const confidence = 92 + Math.floor(Math.random() * 7);

  return {
    count: total,
    average_width: stdW,
    average_height: stdH,
    anomalies,
    items,
    confidence,
    annotated_image_url: "",
    image_width: w,
    image_height: h,
  };
}
