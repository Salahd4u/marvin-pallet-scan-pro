"""
PalletPro inspection backend (FastAPI + OpenCV).

Detects items on a pallet face using contour-based computer vision and flags
size-deviant boxes as anomalies.  Returns item bounding boxes, anomaly details,
and a server-annotated image (base64-encoded JPEG) so the mobile client can
display results without performing its own coordinate math.

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

# ---------------------------------------------------------------------------
# OpenCV import – gracefully degrade if not installed
# ---------------------------------------------------------------------------
try:
    import cv2  # type: ignore[import-untyped]
except Exception:
    cv2 = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="PalletPro API", version="2.0.0")

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
    deviation: int  # percentage


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
    annotated_image_base64: str   # <-- base64-encoded JPEG (no data-URI prefix)
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
# Core detection pipeline
# ============================================================================

# --- Tunable constants -------------------------------------------------------
MIN_BOX_AREA_RATIO = 0.0003   # smallest box relative to image area
MAX_BOX_AREA_RATIO = 0.35     # largest box (avoid full-frame noise)
ASPECT_RATIO_MIN = 0.25       # allow tall/skinny boxes
ASPECT_RATIO_MAX = 4.0        # allow wide/flat boxes
SOLIDITY_MIN = 0.55           # contour area / bounding-rect area
ANOMALY_DEVIATION_PCT = 15    # deviation % above which a box is flagged
GAUSSIAN_KERNEL = (7, 7)      # blur kernel
CLAHE_CLIP = 2.5              # CLAHE contrast limit
CLAHE_GRID = (8, 8)           # CLAHE tile grid
ADAPTIVE_BLOCK = 31           # adaptive-threshold neighbourhood
ADAPTIVE_C = 6                # adaptive-threshold constant
MORPH_KERNEL = (7, 7)         # morphological close kernel
NMS_OVERLAP = 0.25            # IoU threshold for non-max suppression


def analyze_pallet(image_bytes: bytes) -> AnalyzeResponse:
    """Run the full detection pipeline on a JPEG / PNG byte buffer."""

    if cv2 is None:
        return _empty_response(0, 0)

    # Decode image -----------------------------------------------------------
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return _empty_response(0, 0)

    h, w = bgr.shape[:2]
    area = w * h

    # ---------- step 1: pre-processing --------------------------------------
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # CLAHE normalises uneven lighting (warehouse flood-lights, shadows).
    clahe = cv2.createCLAHE(clipLimit=CLAHE_CLIP, tileGridSize=CLAHE_GRID)
    equalised = clahe.apply(gray)

    # Gaussian blur to suppress sensor noise.
    blurred = cv2.GaussianBlur(equalised, GAUSSIAN_KERNEL, 0)

    # ---------- step 2: binarise via adaptive threshold ---------------------
    # Adaptive threshold is far more robust than Canny on real pallet photos
    # because it handles local illumination changes (shadows, reflections).
    binary = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        ADAPTIVE_BLOCK,
        ADAPTIVE_C,
    )

    # Morphological close – bridges small gaps inside item boundaries.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, MORPH_KERNEL)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

    # ---------- step 3: contour extraction ----------------------------------
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # ---------- step 4: filter contours to plausible item boxes -------------
    boxes: List[Tuple[int, int, int, int]] = []
    min_area = area * MIN_BOX_AREA_RATIO
    max_area = area * MAX_BOX_AREA_RATIO

    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        box_area = bw * bh
        if box_area < min_area or box_area > max_area:
            continue
        aspect = bw / max(bh, 1)
        if aspect < ASPECT_RATIO_MIN or aspect > ASPECT_RATIO_MAX:
            continue
        # Solidity check – avoids oddly-shaped noise blobs.
        contour_area = cv2.contourArea(c)
        if contour_area / max(box_area, 1) < SOLIDITY_MIN:
            continue
        boxes.append((x, y, bw, bh))

    if not boxes:
        return _empty_response(w, h)

    # ---------- step 5: non-max suppression (remove duplicate overlaps) -----
    boxes = _non_max_suppression(boxes, NMS_OVERLAP)

    # ---------- step 6: compute standard size, flag anomalies ---------------
    widths = np.array([b[2] for b in boxes])
    heights = np.array([b[3] for b in boxes])
    std_w = int(round(float(np.median(widths))))
    std_h = int(round(float(np.median(heights))))
    std_area_val = std_w * std_h

    anomalies: List[Anomaly] = []
    items: List[DetectedItem] = []
    for i, (x, y, bw, bh) in enumerate(boxes, start=1):
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

    # ---------- step 7: confidence score ------------------------------------
    # Confidence = base 85 – penalty per anomaly, clamped to [60, 99].
    confidence = max(60, min(99, 85 - len(anomalies) * 4))

    # ---------- step 8: generate annotated image ----------------------------
    annotated_b64 = _render_annotated(bgr, boxes, anomalies, std_w, std_h, w, h)

    return AnalyzeResponse(
        count=len(boxes),
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
# Helpers
# ============================================================================


def _non_max_suppression(
    boxes: List[Tuple[int, int, int, int]], overlap_thresh: float
) -> List[Tuple[int, int, int, int]]:
    """Merge / remove highly-overlapping bounding rectangles."""
    if len(boxes) <= 1:
        return boxes

    # Convert to (x1, y1, x2, y2) for IoU math.
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


def _render_annotated(
    bgr: np.ndarray,
    boxes: List[Tuple[int, int, int, int]],
    anomalies: List[Anomaly],
    std_w: int,
    std_h: int,
    img_w: int,
    img_h: int,
) -> str:
    """Draw green rects on normal items, red rects + dots on anomalies, return b64 JPEG."""

    # Work on a copy so the original stays clean.
    out = bgr.copy()
    anomaly_ids = {a.id for a in anomalies}

    line_thickness = max(2, int(round(min(img_w, img_h) * 0.0025)))
    font_scale = max(0.4, min(img_w, img_h) * 0.00055)

    for i, (x, y, bw, bh) in enumerate(boxes, start=1):
        if i in anomaly_ids:
            # Anomaly: filled red rect + label
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 0, 255), line_thickness)
            cx, cy = x + bw // 2, y + bh // 2
            cv2.circle(out, (cx, cy), max(6, line_thickness * 2), (0, 0, 255), -1)
            cv2.putText(
                out,
                f"#{i}",
                (x + 4, y + max(14, int(font_scale * 30))),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (0, 0, 255),
                max(1, line_thickness // 2),
                cv2.LINE_AA,
            )
        else:
            # Normal item: green outline
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 220, 80), line_thickness)

    # Draw standard-size reference in the top-left corner.
    ref_text = f"Standard: {std_w}x{std_h} px"
    cv2.putText(
        out,
        ref_text,
        (12, max(24, int(font_scale * 36))),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale * 0.9,
        (255, 255, 255),
        max(1, line_thickness // 2),
        cv2.LINE_AA,
    )

    # Count badge top-right.
    count_text = f"Items: {len(boxes)}  Anomalies: {len(anomaly_ids)}"
    (tw, th), _ = cv2.getTextSize(count_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.85, max(1, line_thickness // 2))
    cv2.rectangle(
        out,
        (img_w - tw - 20, 4),
        (img_w - 4, th + 16),
        (30, 30, 30),
        -1,
    )
    cv2.putText(
        out,
        count_text,
        (img_w - tw - 12, th + 10),
        cv2.FONT_HERSHEY_SIMPLEX,
        font_scale * 0.85,
        (255, 255, 255),
        max(1, line_thickness // 2),
        cv2.LINE_AA,
    )

    # Encode → base64 string.
    success, buffer = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 88])
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
