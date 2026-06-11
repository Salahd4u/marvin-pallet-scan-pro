"""
PalletPro inspection backend (FastAPI + OpenCV).

Detects items on a pallet face using multiple contour-based CV strategies and
flags size-deviant boxes as anomalies.  Returns item bounding boxes, anomaly
details, and a server-annotated image (base64-encoded JPEG).

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Point the Expo app at this server by setting in expo/.env:
    EXPO_PUBLIC_ANALYZE_API_URL=http://<your-lan-ip>:8000
"""

from __future__ import annotations

import base64
import io
import math
from typing import List, Tuple

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import cv2  # type: ignore[import-untyped]
except Exception:
    cv2 = None  # type: ignore[assignment]

app = FastAPI(title="PalletPro API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class Anomaly(BaseModel):
    id: int
    x: int
    y: int
    width: int
    height: int
    deviation: int


class DetectedItem(BaseModel):
    id: int
    x: int
    y: int
    width: int
    height: int


class AnalyzeResponse(BaseModel):
    count: int
    average_width: int
    average_height: int
    anomalies: List[Anomaly]
    items: List[DetectedItem]
    confidence: int
    annotated_image_base64: str
    image_width: int
    image_height: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "opencv": cv2 is not None}


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    raw = await file.read()
    return analyze_pallet(raw)


# ============================================================================
# Tunable constants
# ============================================================================

# --- Area filters (relative to image area) ---
MIN_BOX_AREA_RATIO = 0.0005   # discard tiny specks
MAX_BOX_AREA_RATIO = 0.40     # discard full-frame blobs

# --- Shape filters ---
ASPECT_RATIO_MIN = 0.3
ASPECT_RATIO_MAX = 3.5
SOLIDITY_MIN = 0.60            # contour area / bounding-rect area

# --- Canny ---
CANNY_LOW = 30
CANNY_HIGH = 100
CANNY_DILATE_ITERS = 2

# --- Adaptive threshold (both polarities) ---
ADAPTIVE_BLOCK = 41            # larger block = more local
ADAPTIVE_C = 8
ADAPTIVE_CLOSE_ITERS = 2

# --- Morphology ---
MORPH_CLOSE_KERNEL = (7, 7)
MORPH_OPEN_KERNEL = (3, 3)

# --- Anomaly ---
ANOMALY_DEVIATION_PCT = 15

# --- NMS ---
NMS_OVERLAP = 0.3


# ============================================================================
# Core pipeline
# ============================================================================


def analyze_pallet(image_bytes: bytes) -> AnalyzeResponse:
    """Run the full multi-strategy detection pipeline."""

    if cv2 is None:
        return _empty_response(0, 0)

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return _empty_response(0, 0)

    h, w = bgr.shape[:2]
    img_area = w * h

    # --- Pre-processing -----------------------------------------------------
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # CLAHE normalises uneven lighting (warehouse flood-lights, shadows).
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    equalised = clahe.apply(gray)

    # Mild Gaussian blur to suppress sensor noise without washing out edges.
    blurred = cv2.GaussianBlur(equalised, (5, 5), 0)

    # --- Collect candidate boxes from multiple strategies --------------------

    all_boxes: List[Tuple[int, int, int, int]] = []

    # Strategy 1 — Canny edge detection.
    #   Edges are the most reliable feature of box boundaries regardless of
    #   lighting or box colour.  We dilate to close small edge gaps then
    #   extract external contours.
    all_boxes.extend(_detect_edges(blurred, img_area))

    # Strategy 2 — Adaptive threshold (THRESH_BINARY).
    #   Finds lighter regions (boxes) on a darker background.
    all_boxes.extend(_detect_threshold(blurred, img_area, cv2.THRESH_BINARY))

    # Strategy 3 — Adaptive threshold (THRESH_BINARY_INV).
    #   Finds darker regions (boxes) on a lighter background.
    all_boxes.extend(_detect_threshold(blurred, img_area, cv2.THRESH_BINARY_INV))

    # Strategy 4 — Morphological gradient.
    #   Highlights boundaries between similarly-coloured adjacent boxes.
    all_boxes.extend(_detect_gradient(blurred, img_area))

    if not all_boxes:
        # Last-resort: try Canny with more permissive thresholds.
        all_boxes.extend(_detect_edges(blurred, img_area, low=15, high=60, iters=3))

    if not all_boxes:
        return _empty_response(w, h)

    # --- Deduplicate overlapping boxes ---------------------------------------
    all_boxes = _non_max_suppression(all_boxes, NMS_OVERLAP)

    if not all_boxes:
        return _empty_response(w, h)

    # --- Compute standard size, flag anomalies -------------------------------
    widths = np.array([b[2] for b in all_boxes])
    heights = np.array([b[3] for b in all_boxes])

    # Use median — robust against outlier boxes.
    std_w = int(round(float(np.median(widths))))
    std_h = int(round(float(np.median(heights))))
    std_area_val = std_w * std_h

    anomalies: List[Anomaly] = []
    items: List[DetectedItem] = []
    for i, (x, y, bw, bh) in enumerate(all_boxes, start=1):
        ba = bw * bh
        deviation = int(round(abs(ba - std_area_val) / max(std_area_val, 1) * 100))
        if deviation >= ANOMALY_DEVIATION_PCT:
            anomalies.append(
                Anomaly(id=i, x=int(x), y=int(y), width=int(bw), height=int(bh), deviation=deviation)
            )
        else:
            items.append(
                DetectedItem(id=i, x=int(x), y=int(y), width=int(bw), height=int(bh))
            )

    confidence = max(50, min(99, 90 - len(anomalies) * 5))

    annotated_b64 = _render_annotated(bgr, all_boxes, anomalies, std_w, std_h, w, h)

    return AnalyzeResponse(
        count=len(all_boxes),
        average_width=std_w,
        average_height=std_h,
        anomalies=anomalies,
        items=items,
        confidence=confidence,
        annotated_image_base64=annotated_b64,
        image_width=w,
        image_height=h,
    )


# ============================================================================
# Detection strategies
# ============================================================================


def _detect_edges(
    gray: np.ndarray,
    img_area: int,
    low: int = CANNY_LOW,
    high: int = CANNY_HIGH,
    iters: int = CANNY_DILATE_ITERS,
) -> List[Tuple[int, int, int, int]]:
    """Canny edge detection → dilate → contour extraction."""
    edges = cv2.Canny(gray, low, high)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    dilated = cv2.dilate(edges, kernel, iterations=iters)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return _filter_rectangular_contours(contours, img_area)


def _detect_threshold(
    gray: np.ndarray,
    img_area: int,
    thresh_type: int,
) -> List[Tuple[int, int, int, int]]:
    """Adaptive threshold → morphological close → contour extraction."""
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresh_type,
        ADAPTIVE_BLOCK,
        ADAPTIVE_C,
    )
    # Close small holes inside detected regions.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, MORPH_CLOSE_KERNEL)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, close_kernel, iterations=ADAPTIVE_CLOSE_ITERS)
    # Open to remove small noise bridges between adjacent regions.
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_OPEN_KERNEL)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, open_kernel, iterations=1)

    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return _filter_rectangular_contours(contours, img_area)


def _detect_gradient(
    gray: np.ndarray,
    img_area: int,
) -> List[Tuple[int, int, int, int]]:
    """Morphological gradient → threshold → contour extraction.

    The gradient (dilation - erosion) highlights boundaries between regions
    of similar intensity — perfect for finding seams between adjacent boxes
    whose faces have nearly identical colour.
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)
    # Threshold the gradient to get clean boundary lines.
    _, binary = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Dilate to connect nearby boundary fragments into closed loops.
    dilated = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)), iterations=3)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return _filter_rectangular_contours(contours, img_area)


# ============================================================================
# Contour filtering
# ============================================================================


def _filter_rectangular_contours(
    contours: list,
    img_area: int,
) -> List[Tuple[int, int, int, int]]:
    """Keep only contours that plausibly represent rectangular box faces.

    Filters by:
      1. Area (relative to image size)
      2. Approximated polygon vertex count (4 = rectangle)
      3. Aspect ratio of bounding rect
      4. Solidity (contour area / bounding-rect area)
    """
    min_area = img_area * MIN_BOX_AREA_RATIO
    max_area = img_area * MAX_BOX_AREA_RATIO

    results: List[Tuple[int, int, int, int]] = []

    for c in contours:
        contour_area = cv2.contourArea(c)
        if contour_area < min_area or contour_area > max_area:
            continue

        # Bounding rect for quick aspect-ratio check.
        x, y, bw, bh = cv2.boundingRect(c)
        box_area = bw * bh
        if box_area < 1:
            continue

        aspect = bw / max(bh, 1)
        if aspect < ASPECT_RATIO_MIN or aspect > ASPECT_RATIO_MAX:
            continue

        # Solidity: how well the contour fills its bounding rect.
        if contour_area / box_area < SOLIDITY_MIN:
            continue

        # Approximate to polygon — rectangular items should have ~4 vertices.
        peri = cv2.arcLength(c, closed=True)
        approx = cv2.approxPolyDP(c, 0.04 * peri, closed=True)
        vertices = len(approx)

        # Accept 4-vertex shapes (rectangles), and also accept 5-8 vertex
        # shapes if solidity is high (slightly rounded rectangles).
        if vertices == 4:
            results.append((int(x), int(y), int(bw), int(bh)))
        elif 5 <= vertices <= 8 and contour_area / box_area > 0.75:
            results.append((int(x), int(y), int(bw), int(bh)))

    return results


# ============================================================================
# Non-Max Suppression
# ============================================================================


def _non_max_suppression(
    boxes: List[Tuple[int, int, int, int]], overlap_thresh: float
) -> List[Tuple[int, int, int, int]]:
    """Merge / remove highly-overlapping bounding rectangles via IoU."""
    if len(boxes) <= 1:
        return boxes

    rects = np.array([[x, y, x + w, y + h] for x, y, w, h in boxes], dtype=np.float32)
    areas = (rects[:, 2] - rects[:, 0]) * (rects[:, 3] - rects[:, 1])
    order = areas.argsort()[::-1]

    keep: List[int] = []
    while len(order) > 0:
        i = order[0]
        keep.append(i)

        xx1 = np.maximum(rects[i, 0], rects[order[1:], 0])
        yy1 = np.maximum(rects[i, 1], rects[order[1:], 1])
        xx2 = np.minimum(rects[i, 2], rects[order[1:], 2])
        yy2 = np.minimum(rects[i, 3], rects[order[1:], 3])

        inter_w = np.maximum(0, xx2 - xx1)
        inter_h = np.maximum(0, yy2 - yy1)
        inter = inter_w * inter_h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)

        remaining = np.where(iou <= overlap_thresh)[0]
        order = order[remaining + 1]

    return [boxes[i] for i in keep]


# ============================================================================
# Annotation renderer
# ============================================================================


def _render_annotated(
    bgr: np.ndarray,
    boxes: List[Tuple[int, int, int, int]],
    anomalies: List[Anomaly],
    std_w: int,
    std_h: int,
    img_w: int,
    img_h: int,
) -> str:
    """Draw green rects on normal items, red rects + centre dots on anomalies, return b64 JPEG."""

    out = bgr.copy()
    anomaly_ids = {a.id for a in anomalies}

    line_thickness = max(3, int(round(min(img_w, img_h) * 0.003)))
    font_scale = max(0.45, min(img_w, img_h) * 0.0006)

    for i, (x, y, bw, bh) in enumerate(boxes, start=1):
        if i in anomaly_ids:
            # Anomaly: filled red rect + centre dot + label
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 0, 255), line_thickness)
            cx, cy = x + bw // 2, y + bh // 2
            cv2.circle(out, (cx, cy), max(6, line_thickness * 2), (0, 0, 255), -1)
            cv2.putText(
                out,
                f"#{i}",
                (x + 5, y + max(16, int(font_scale * 30))),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (0, 0, 255),
                max(1, line_thickness // 2),
                cv2.LINE_AA,
            )
        else:
            # Normal item: green outline with slight fill for visibility
            overlay = out.copy()
            cv2.rectangle(overlay, (x, y), (x + bw, y + bh), (0, 220, 80), -1)
            cv2.addWeighted(overlay, 0.12, out, 0.88, 0, out)
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 230, 70), line_thickness)

    # Standard-size reference, top-left.
    ref_text = f"Std: {std_w}x{std_h} px"
    cv2.putText(
        out,
        ref_text,
        (14, max(28, int(font_scale * 40))),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale * 0.9,
        (255, 255, 255),
        max(1, line_thickness // 2),
        cv2.LINE_AA,
    )

    # Count badge, top-right.
    count_text = f"Items: {len(boxes)}  Anomalies: {len(anomaly_ids)}"
    (tw, th), _ = cv2.getTextSize(
        count_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.85, max(1, line_thickness // 2)
    )
    cv2.rectangle(
        out,
        (img_w - tw - 22, 6),
        (img_w - 6, th + 18),
        (30, 30, 30),
        -1,
    )
    cv2.putText(
        out,
        count_text,
        (img_w - tw - 14, th + 12),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale * 0.85,
        (255, 255, 255),
        max(1, line_thickness // 2),
        cv2.LINE_AA,
    )

    success, buffer = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not success:
        return ""
    return base64.b64encode(buffer).decode("utf-8")


def _empty_response(w: int, h: int) -> AnalyzeResponse:
    return AnalyzeResponse(
        count=0,
        average_width=0,
        average_height=0,
        anomalies=[],
        items=[],
        confidence=0,
        annotated_image_base64="",
        image_width=w,
        image_height=h,
    )
