import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import type {
  AnalyzeResponse,
  Defect,
  DefectType,
  Severity,
  WindowFrame,
  WindowType,
} from "@/types/inspection";
import { DEFECT_LABELS, WINDOW_TYPES } from "@/types/inspection";

/**
 * Real AI window quality inspection via the kie.ai Gemini 3 Flash vision endpoint.
 *
 * The model receives a photo (a building facade, a wall of windows, or a single
 * window close-up) and returns:
 *   - every visible window frame (bounding boxes in normalized [0,1] coords)
 *   - every visible defect on those frames (type, severity, bounding box, note)
 *
 * Numbering, sorting (top-to-bottom, left-to-right), average-size computation,
 * and defect aggregation are performed locally as deterministic post-processing.
 *
 * Endpoint: https://api.kie.ai/gemini-3-flash/v1/chat/completions
 * Auth:     Bearer EXPO_PUBLIC_KIE_API_KEY
 */

const KIE_ENDPOINT =
  "https://api.kie.ai/gemini-3-flash/v1/chat/completions";
const KIE_MODEL = "gemini-3-flash";
const API_KEY = process.env.EXPO_PUBLIC_KIE_API_KEY;

/** Raw frame as returned by the model (normalized coordinates, 0..1). */
type RawBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RawDefect = RawBox & {
  type: string;
  severity?: string;
  note?: string;
};

type RawFrame = RawBox & {
  window_type?: string;
  type_confidence?: number;
};

type DetectionPayload = {
  frames?: RawFrame[];
  defects?: RawDefect[];
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
    const dest = `${FileSystem.cacheDirectory}window_scan_${Date.now()}.jpg`;
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

  // Native: fall back to a 4:3 default — the model returns normalized coords,
  // so absolute size only affects overlay sizing, not correctness.
  return { width: 1024, height: 768 };
}

/** All valid Marvin WindowType ids for fast lookup. */
const VALID_WINDOW_TYPES: Set<string> = new Set(
  WINDOW_TYPES.map((w) => w.id),
);

/** Normalize a model-returned window type string into a WindowType id. */
function normalizeWindowType(raw: string): WindowType {
  const v = String(raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_");
  if (VALID_WINDOW_TYPES.has(v)) return v as WindowType;
  // Common aliases.
  const aliases: Record<string, WindowType> = {
    bay: "bay_bow",
    bow: "bay_bow",
    "bay_and_bow": "bay_bow",
    "bay_bow_window": "bay_bow",
    sliding: "glider",
    slider: "glider",
    "horizontal_slider": "glider",
    fixed: "picture",
    "direct_glaze": "picture",
    picture_window: "picture",
    double_hung_window: "double_hung",
    "double_hung": "double_hung",
    single_hung_window: "single_hung",
    casement_window: "casement",
    awning_window: "awning",
    corner_window: "corner",
    specialty_shape: "specialty",
    custom: "specialty",
    arched: "specialty",
    round: "specialty",
    circular: "specialty",
    triangular: "specialty",
  };
  return aliases[v] ?? "unknown";
}

const DEFECT_TYPES: DefectType[] = [
  "scratch",
  "crack",
  "chip",
  "dent",
  "warp",
  "misalign",
  "discolor",
  "break",
  "other",
];

function normalizeDefectType(raw: string): DefectType {
  const v = String(raw ?? "").toLowerCase().trim();
  const map: Record<string, DefectType> = {
    scratch: "scratch",
    scratched: "scratch",
    crack: "crack",
    cracked: "crack",
    fracture: "crack",
    chip: "chip",
    chipped: "chip",
    flake: "chip",
    flaking: "chip",
    dent: "dent",
    dented: "dent",
    warp: "warp",
    warped: "warp",
    bow: "warp",
    bent: "warp",
    misalign: "misalign",
    misalignment: "misalign",
    misaligned: "misalign",
    discolor: "discolor",
    discoloration: "discolor",
    stain: "discolor",
    faded: "discolor",
    break: "break",
    broken: "break",
    shattered: "break",
    smash: "break",
    other: "other",
  };
  return map[v] ?? "other";
}

function normalizeSeverity(raw: string): Severity {
  const v = String(raw ?? "").toLowerCase().trim();
  if (v === "high" || v === "severe" || v === "critical" || v === "major") return "high";
  if (v === "medium" || v === "moderate") return "medium";
  return "low";
}

const WINDOW_TYPE_DOCS = WINDOW_TYPES.filter((w) => w.id !== "unknown")
  .map(
    (w) =>
      `  - "${w.id}" — ${w.name}. ${w.style}. Visual cues: ${w.visualCues}`,
  )
  .join("\n");

const DETECTION_PROMPT = `You are an expert computer-vision system for window quality inspection on building facades.

The attached image is a photo of one or more windows (a building facade, a wall of windows, or a single window close-up). The goal is to detect quality defects on the visible window frames and glass AND to classify each window into one of Marvin's window product types.

Marvin window product types (use the id string in the "window_type" field):
${WINDOW_TYPE_DOCS}
  - "unknown" — only if none of the above clearly match.

Your tasks:
1. Detect EVERY visible individual window frame in the image. Even if multiple windows are in a grid, list each one separately.
2. For each frame, classify it into the closest Marvin window type above using its visible geometry (sash count, hinge position, meeting rails, shape, projection). Put the id in "window_type" and your confidence (0..100) in "type_confidence".
3. Detect EVERY visible defect on any window frame or glass, INCLUDING VERY SMALL / TINY defects. A defect is any manufacturing or installation flaw, including:
   - scratch (surface scratch on frame or glass — even hairline)
   - crack (crack in the glass or frame material — even hairline)
   - chip (chipped or flaked coating/material at an edge — even a tiny speck of missing coating, a small edge nick, or a pinhead-sized flake)
   - dent (dented or deformed frame)
   - warp (warped, bowed, or bent frame — not straight)
   - misalign (misaligned frame joints, mullions, or sashes that do not meet squarely)
   - discolor (discoloration, staining, fading, or coating defect — even a small spot)
   - break (broken or shattered glass)
   - other (any defect that does not fit the above)

   IMPORTANT — TINY-DEFECT MODE:
   - Carefully scan window edges, corners, glass surfaces, and frame joints for small chips, nicks, and flakes. These are the most commonly MISSED defects.
   - A chip can be as small as a few pixels — a tiny missing speck of coating at a frame edge, a small nick on a corner, or a small flake of paint/material. Even if tiny, STILL report it.
   - Draw a TIGHT bounding box around just the defect itself, even if it is very small. Do NOT skip a defect just because the box would be small.
   - When in doubt about whether a small mark is a defect, report it with severity "low" and describe it in the note.
   - It is better to over-report small defects than to miss them.

Return ONLY a JSON object (no markdown, no explanation) with this exact shape:
{
  "frames": [
    {
      "x": <number>,
      "y": <number>,
      "width": <number>,
      "height": <number>,
      "window_type": "awning|bay_bow|casement|corner|double_hung|glider|picture|single_hung|specialty|unknown",
      "type_confidence": <integer 0..100>
    }
  ],
  "defects": [
    {
      "x": <number>,
      "y": <number>,
      "width": <number>,
      "height": <number>,
      "type": "scratch|crack|chip|dent|warp|misalign|discolor|break|other",
      "severity": "low|medium|high",
      "note": "<short description, max 80 chars>"
    }
  ],
  "confidence": <integer 0..100>
}

Rules:
- All x, y, width, height are NORMALIZED coordinates in [0, 1], relative to the full image.
- (x, y) is the top-left corner of the bounding box. width and height are the box size.
- Every coordinate value must be a number between 0 and 1. Boxes must stay inside the image.
- For "frames": do NOT include doors, walls, or background — only window frames (the outer frame that holds the glass).
- For "defects": every defect box should be tight around the defect itself (not the whole frame). Boxes may be VERY SMALL (a tiny chip can have width/height as small as 0.005). Do NOT filter out small boxes — report them all. If a defect spans a whole frame, its box may equal the frame box.
- "window_type" MUST be one of the exact id values listed above. Choose the closest visual match; do not default to "unknown" unless truly ambiguous.
- "type_confidence" reflects how well the visible geometry matches the chosen Marvin type.
- "type" (defects) MUST be one of the exact values listed above.
- "severity" MUST be one of "low", "medium", "high". Use "low" for cosmetic, "medium" for functional, "high" for structural / broken glass / major misalignment.
- If no defects are visible, return an empty "defects" array.
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

function dedupBoxes<T extends RawBox>(boxes: T[], iouThreshold: number): T[] {
  const list = boxes
    .slice()
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: T[] = [];
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

function iouNorm(a: RawBox, b: RawBox): number {
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

function computeConfidence(frameCount: number, defectCount: number, modelConf: number | null): number {
  if (modelConf != null && Number.isFinite(modelConf)) {
    return Math.max(0, Math.min(100, Math.round(modelConf)));
  }
  if (frameCount === 0) return 40;
  let base = 80;
  if (frameCount >= 3) base += 6;
  if (frameCount >= 10) base += 6;
  return Math.min(99, base);
}

/**
 * Run real AI window quality inspection via kie.ai Gemini 3 Flash.
 * Returns a fully-formed AnalyzeResponse with numbered frames, defects,
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

  if (!parsed) {
    throw new Error(
      "The AI did not return a valid result. Try a clearer, straight-on photo of the window(s)."
    );
  }

  // --- Normalize frames ---
  const rawFrames: Array<RawFrame & { _type: WindowType; _typeConf: number }> = [];
  for (const p of parsed.frames ?? []) {
    const x = clamp01(Number(p.x));
    const y = clamp01(Number(p.y));
    const w = clamp01(Number(p.width));
    const h = clamp01(Number(p.height));
    if (w <= 0.005 || h <= 0.005) continue;
    const cw = Math.min(w, 1 - x);
    const ch = Math.min(h, 1 - y);
    if (cw <= 0.005 || ch <= 0.005) continue;
    const winType = normalizeWindowType(p.window_type ?? "");
    const typeConfRaw = Number(p.type_confidence);
    const typeConf =
      Number.isFinite(typeConfRaw) && typeConfRaw >= 0 && typeConfRaw <= 100
        ? Math.round(typeConfRaw)
        : winType === "unknown"
          ? 30
          : 70;
    rawFrames.push({
      x,
      y,
      width: cw,
      height: ch,
      window_type: winType,
      type_confidence: typeConf,
      _type: winType,
      _typeConf: typeConf,
    });
  }

  const dedupedFrames = dedupBoxes(rawFrames, 0.8);

  // Convert to pixel-space frames with center points.
  const frameItems: Array<WindowFrame & { cx: number; cy: number }> =
    dedupedFrames.map((p) => {
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
        windowType: p._type,
        typeConfidence: p._typeConf,
        cx: x + w / 2,
        cy: y + h / 2,
      };
    });

  // Sort top-to-bottom, left-to-right using row banding.
  const bandH = Math.max(16, Math.round(imgH / 24));
  frameItems.sort((a, b) => {
    const rowA = Math.floor(a.cy / bandH);
    const rowB = Math.floor(b.cy / bandH);
    if (rowA !== rowB) return rowA - rowB;
    return a.cx - b.cx;
  });

  // Assign sequential numbers.
  frameItems.forEach((it, i) => {
    it.id = i + 1;
  });

  // Average frame size.
  const totalW = frameItems.reduce((s, it) => s + it.width, 0);
  const totalH = frameItems.reduce((s, it) => s + it.height, 0);
  const avgW = frameItems.length > 0 ? totalW / frameItems.length : 0;
  const avgH = frameItems.length > 0 ? totalH / frameItems.length : 0;

  // --- Normalize defects ---
  const rawDefects: Array<RawDefect & { _type: DefectType; _sev: Severity }> = [];
  for (const d of parsed.defects ?? []) {
    const x = clamp01(Number(d.x));
    const y = clamp01(Number(d.y));
    const w = clamp01(Number(d.width));
    const h = clamp01(Number(d.height));
    // Keep very small defects (tiny chips, nicks, specks). Only drop truly
    // zero/negative-size boxes — a real chip can be as small as ~0.4% of the image.
    if (w <= 0.0008 || h <= 0.0008) continue;
    const cw = Math.min(w, 1 - x);
    const ch = Math.min(h, 1 - y);
    if (cw <= 0.0008 || ch <= 0.0008) continue;
    const t = normalizeDefectType(d.type);
    rawDefects.push({
      x,
      y,
      width: cw,
      height: ch,
      type: t,
      severity: normalizeSeverity(d.severity ?? "low"),
      note: typeof d.note === "string" ? d.note.slice(0, 120) : undefined,
      _type: t,
      _sev: normalizeSeverity(d.severity ?? "low"),
    });
  }

  // Use a higher IoU threshold for defects so a tiny chip next to a larger
  // defect (e.g. a chip near a crack) is NOT merged away.
  const dedupedDefects = dedupBoxes(rawDefects, 0.9);

  // Convert defects to pixel space + assign sequential ids sorted by position.
  const defectPixels: Array<RawDefect & { _type: DefectType; _sev: Severity; px: number; py: number }> =
    dedupedDefects.map((d) => ({
      ...d,
      px: Math.round(d.x * imgW),
      py: Math.round(d.y * imgH),
    }));

  // Sort defects top-to-bottom, left-to-right for stable numbering.
  defectPixels.sort((a, b) => {
    const rowA = Math.floor((a.py + a.height * imgH / 2) / bandH);
    const rowB = Math.floor((b.py + b.height * imgH / 2) / bandH);
    if (rowA !== rowB) return rowA - rowB;
    return a.px - b.px;
  });

  const defects: Defect[] = defectPixels.map((d, i) => ({
    id: i + 1,
    type: d._type,
    label: DEFECT_LABELS[d._type],
    severity: d._sev,
    x: d.px,
    y: d.py,
    width: Math.round(d.width * imgW),
    height: Math.round(d.height * imgH),
    note: d.note,
  }));

  // Suppress unused-locals for DEFECT_TYPES (kept for future filtering UI).
  void DEFECT_TYPES;

  const modelConf = Number.isFinite(parsed.confidence)
    ? (parsed.confidence as number)
    : null;
  const confidence = computeConfidence(frameItems.length, defects.length, modelConf);

  // Clean items for the response (drop internal cx/cy).
  const cleanItems: WindowFrame[] = frameItems.map((it) => ({
    id: it.id,
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
    windowType: it.windowType,
    typeConfidence: it.typeConfidence,
  }));

  return {
    count: frameItems.length,
    average_width: Math.round(avgW),
    average_height: Math.round(avgH),
    defects,
    defectCount: defects.length,
    confidence,
    annotated_image_base64: "", // overlay is rendered natively via SVG
    items: cleanItems,
    image_width: imgW,
    image_height: imgH,
  };
}
