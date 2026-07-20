import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import type {
  AnalyzeResponse,
  Anomaly,
  DetectedItem,
} from "@/types/inspection";

/**
 * Real AI detection via the kie.ai Gemini 3 Flash vision endpoint.
 *
 * The model receives the pallet photo and returns a JSON list of detected wood
 * pieces with bounding boxes in normalized [0,1] coordinates. Numbering,
 * sorting (top-to-bottom, left-to-right), size analysis, and anomaly detection
 * (>10% deviation from average) are performed locally — those are deterministic
 * post-processing steps.
 *
 * Endpoint: https://api.kie.ai/gemini-3-flash/v1/chat/completions
 * Auth:     Bearer EXPO_PUBLIC_KIE_API_KEY
 */

const KIE_ENDPOINT =
  "https://api.kie.ai/gemini-3-flash/v1/chat/completions";
const KIE_MODEL = "gemini-3-flash";
const API_KEY = process.env.EXPO_PUBLIC_KIE_API_KEY;

const ANOMALY_THRESHOLD = 0.1; // 10% deviation from average size

/** Raw piece as returned by the model (normalized coordinates, 0..1). */
type RawPiece = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectionPayload = {
  pieces: RawPiece[];
  confidence?: number;
};

/**
 * Convert any image URI (file://, content://, ph://, asset, data:, http) into
 * a base64 data URI so it can be embedded directly in the chat request.
 */
async function toDataUri(uri: string): Promise<string> {
  if (uri.startsWith("data:")) return uri;

  if (Platform.OS === "web") {
    try {
      const res = await fetch(uri);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read image."));
        reader.readAsDataURL(blob);
      });
    } catch {
      return uri;
    }
  }

  let fileUri = uri;
  if (uri.startsWith("content://") || uri.startsWith("ph://")) {
    const dest = `${FileSystem.cacheDirectory}pallet_scan_${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    fileUri = dest;
  }

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const mime = fileUri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

/** Resolve true pixel dimensions of the image (falls back gracefully). */
async function resolveDimensions(
  uri: string
): Promise<{ width: number; height: number }> {
  if (Platform.OS === "web") {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({
          width: img.naturalWidth || img.width || 1000,
          height: img.naturalHeight || img.height || 1000,
        });
      img.onerror = () => resolve({ width: 1000, height: 1000 });
      img.src = uri;
    });
  }

  // Native: read file size, but for true pixel dimensions we rely on the
  // caller having staged them. Fall back to a 4:3 default so overlays still
  // render (the model returns normalized coords, so absolute size only
  // affects circle/font sizing, not correctness).
  return { width: 1024, height: 768 };
}

const DETECTION_PROMPT = `You are an expert computer-vision system for pallet inspection.

The attached image is a straight-on photo of the FRONT FACE of a pallet loaded with wood pieces (lumber, trim boards, mouldings, wood profiles, or building materials).

Your task: detect EVERY visible individual wood piece on the pallet face. Even tightly packed pieces must be separated into individual detections.

Return ONLY a JSON object (no markdown, no explanation) with this exact shape:
{
  "pieces": [
    { "x": <number>, "y": <number>, "width": <number>, "height": <number> }
  ],
  "confidence": <integer 0..100>
}

Rules:
- x, y, width, height are NORMALIZED coordinates in [0, 1], relative to the full image.
- (x, y) is the top-left corner of the bounding box. width and height are the box size.
- Every value must be a number between 0 and 1. Boxes must stay inside the image.
- Do NOT include the pallet frame, straps, wrapping, or background — only wood pieces.
- Detect every piece you can see; undercounting is worse than overcounting.
- "confidence" is your confidence in the overall detection quality (0..100).
- Output ONLY the JSON object. No prose, no code fences.`;

/** Robustly extract the JSON object from a model response that may wrap it. */
function extractJson(text: string): DetectionPayload | null {
  if (!text) return null;

  // Strip markdown code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Find the first { ... } block.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as DetectionPayload;
  } catch {
    // Try a tolerant repair: trailing commas.
    try {
      const repaired = slice.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(repaired) as DetectionPayload;
    } catch {
      return null;
    }
  }
}

/** Clamp a normalized value into [0, 1]. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Run real AI detection on the pallet image via kie.ai Gemini 3 Flash.
 * Returns a fully-formed AnalyzeResponse with numbered items, anomalies,
 * and pixel-space coordinates for overlay rendering.
 */
export async function detectWithKie(
  imageUri: string
): Promise<AnalyzeResponse> {
  if (!API_KEY) {
    throw new Error(
      "Detection API key is not configured. Set EXPO_PUBLIC_KIE_API_KEY."
    );
  }

  const [dataUri, dims] = await Promise.all([
    toDataUri(imageUri),
    resolveDimensions(imageUri),
  ]);
  const { width: imgW, height: imgH } = dims;

  const body = {
    model: KIE_MODEL,
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: DETECTION_PROMPT },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
    // Request JSON-only output where supported.
    response_format: { type: "json_object" },
  };

  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Detection request failed (${res.status}). ${errText.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content);

  if (!parsed || !Array.isArray(parsed.pieces) || parsed.pieces.length === 0) {
    throw new Error(
      "The AI could not detect any wood pieces in this image. Try a clearer, straight-on photo of the pallet face."
    );
  }

  // Normalize + clamp every box, drop degenerate ones.
  const rawPieces: RawPiece[] = [];
  for (const p of parsed.pieces) {
    const x = clamp01(Number(p.x));
    const y = clamp01(Number(p.y));
    const w = clamp01(Number(p.width));
    const h = clamp01(Number(p.height));
    if (w <= 0.001 || h <= 0.001) continue;
    // Keep box inside the image.
    const cw = Math.min(w, 1 - x);
    const ch = Math.min(h, 1 - y);
    if (cw <= 0.001 || ch <= 0.001) continue;
    rawPieces.push({ x, y, width: cw, height: ch });
  }

  if (rawPieces.length === 0) {
    throw new Error(
      "No valid wood-piece boxes were returned by the AI. Try a clearer photo."
    );
  }

  // Deduplicate near-identical boxes the model sometimes emits.
  const deduped = dedupPieces(rawPieces, 0.85);

  // Convert to pixel-space items with center points.
  const items: Array<DetectedItem & { cx: number; cy: number; deviation: number }> =
    deduped.map((p) => {
      const x = Math.round(p.x * imgW);
      const y = Math.round(p.y * imgH);
      const w = Math.round(p.width * imgW);
      const h = Math.round(p.height * imgH);
      return {
        id: 0,
        x,
        y,
        width: w,
        height: h,
        cx: x + w / 2,
        cy: y + h / 2,
        deviation: 0,
      };
    });

  // Sort top-to-bottom, left-to-right using row banding.
  const bandH = Math.max(16, Math.round(imgH / 24));
  items.sort((a, b) => {
    const rowA = Math.floor(a.cy / bandH);
    const rowB = Math.floor(b.cy / bandH);
    if (rowA !== rowB) return rowA - rowB;
    return a.cx - b.cx;
  });

  // Assign sequential numbers.
  items.forEach((it, i) => {
    it.id = i + 1;
  });

  // Average size + anomaly detection.
  const totalW = items.reduce((s, it) => s + it.width, 0);
  const totalH = items.reduce((s, it) => s + it.height, 0);
  const avgW = totalW / items.length;
  const avgH = totalH / items.length;

  const anomalies: Anomaly[] = [];
  for (const it of items) {
    const dw = avgW > 0 ? Math.abs(it.width - avgW) / avgW : 0;
    const dh = avgH > 0 ? Math.abs(it.height - avgH) / avgH : 0;
    const deviation = Math.max(dw, dh);
    it.deviation = deviation;
    if (dw > ANOMALY_THRESHOLD || dh > ANOMALY_THRESHOLD) {
      anomalies.push({
        id: it.id,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
        deviation: Math.round(deviation * 100),
      });
    }
  }

  // Confidence: prefer the model's own, but sanity-bound it.
  const modelConf = Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(100, Math.round(parsed.confidence as number)))
    : null;
  const confidence =
    modelConf ??
    computeConfidence(items.length, anomalies.length);

  // Clean items for the response (drop internal cx/cy/deviation).
  const cleanItems: DetectedItem[] = items.map((it) => ({
    id: it.id,
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
  }));

  return {
    count: items.length,
    average_width: Math.round(avgW),
    average_height: Math.round(avgH),
    anomalies,
    confidence,
    annotated_image_base64: "", // overlay is rendered natively via SVG
    items: cleanItems,
    image_width: imgW,
    image_height: imgH,
  };
}

/** Remove boxes that overlap another box by more than `iouThreshold`. */
function dedupPieces(pieces: RawPiece[], iouThreshold: number): RawPiece[] {
  // Sort largest-area first so big boxes absorb small duplicates.
  const list = pieces
    .slice()
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: RawPiece[] = [];
  for (const p of list) {
    let dup = false;
    for (const k of kept) {
      if (iouNorm(p, k) > iouThreshold) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push(p);
  }
  return kept;
}

function iouNorm(a: RawPiece, b: RawPiece): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function computeConfidence(count: number, anomalyCount: number): number {
  if (count === 0) return 40;
  let base = 78;
  if (count >= 5) base += 6;
  if (count >= 20) base += 6;
  if (count >= 60) base += 4;
  const anomalyRatio = anomalyCount / count;
  if (anomalyRatio < 0.15) base += 4;
  return Math.min(99, Math.max(50, base));
}
