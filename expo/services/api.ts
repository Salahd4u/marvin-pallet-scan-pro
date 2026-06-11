import { Paths, Directory } from "expo-file-system";

import type { AnalyzeResponse } from "@/types/inspection";

/**
 * Base URL of the Python FastAPI backend.
 * Configure via EXPO_PUBLIC_ANALYZE_API_URL (e.g. https://your-host).
 * The app will NOT fall back to mock data — a real OpenCV backend is required.
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

export class BackendNotConfiguredError extends Error {
  constructor() {
    super(
      "Analysis backend not configured. Set EXPO_PUBLIC_ANALYZE_API_URL to your FastAPI server address."
    );
    this.name = "BackendNotConfiguredError";
  }
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "BackendError";
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
 * Sends the captured image to `POST /api/analyze` on the FastAPI backend.
 *
 * Throws:
 * - `OfflineError` when the device has no internet connection.
 * - `BackendNotConfiguredError` when no backend URL is set.
 * - `BackendError` when the backend responds with an error or times out.
 *
 * There is NO mock/estimate fallback.  All detection is performed by OpenCV
 * on the real Python backend.
 */
export async function analyzeImage({
  uri,
  width,
  height,
}: AnalyzeArgs): Promise<{ result: AnalyzeResponse; source: "backend" }> {
  const online = await checkConnectivity();
  if (!online) {
    throw new OfflineError();
  }

  if (API_BASE_URL.length === 0) {
    throw new BackendNotConfiguredError();
  }

  const form = new FormData();
  form.append("file", {
    uri,
    name: "pallet.jpg",
    type: "image/jpeg",
  } as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new BackendError("Backend request timed out. Check that the server is running.");
    }
    throw new BackendError(
      `Could not reach the analysis backend at ${API_BASE_URL}. Verify the server is running.`
    );
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { detail?: string };
      detail = body.detail ? ` — ${body.detail}` : "";
    } catch {
      // response body wasn't JSON
    }
    throw new BackendError(
      `Backend returned status ${res.status}${detail}.`,
      res.status
    );
  }

  const data = (await res.json()) as AnalyzeResponse;
  const normalized = normalize(data, width, height);

  // Convert base64 annotated image → local file URI so <Image> can display it.
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
