"""
PalletPro inspection backend (FastAPI + OpenCV + YOLO).

Two detection modes:
  1. Legacy contour-based pallet/item detection  -> POST /api/analyze
  2. YOLO object-detection of window/glass defects -> POST /api/defects

The YOLO endpoint is used by the Expo window-inspection app to get real,
localised defect boxes (scratches, cracks, dents, broken glass) from a
fine-tuned YOLOv8s model. The app keeps using kie.ai (Gemini 3 Flash) for
window-frame classification and merges the YOLO defects in on the client.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import base64
import io
from typing import List, Tuple

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import cv2  # type: ignore[import-untyped]
except Exception:
    cv2 = None  # type: ignore[assignment]

from yolo_detector import detect_defects, is_available as yolo_available, model_ready


app = FastAPI(title="PalletPro API", version="4.0.0")

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


class YoloDefectOut(BaseModel):
    id: int
    type: str           # app defect type id: scratch|crack|chip|dent|warp|misalign|discolor|break|other
    raw_class: str      # raw YOLO class name
    severity: str       # low|medium|high
    confidence: float   # 0..1
    x: int
    y: int
    width: int
    height: int


class DefectsResponse(BaseModel):
    defects: List[YoloDefectOut]
    count: int
    image_width: int
    image_height: int
    model: str
    model_loaded: bool


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "opencv": cv2 is not None,
        "yolo_available": yolo_available(),
        "yolo_loaded": model_ready(),
    }


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    raw = await file.read()
    return analyze_pallet(raw)


@app.post("/api/defects", response_model=DefectsResponse)
async def detect_defects_endpoint(file: UploadFile = File(...)) -> DefectsResponse:
    """Run YOLO defect detection on an uploaded image.

    Returns defect bounding boxes in source-image pixel coordinates, with each
    defect mapped to the app's DefectType and a severity. Used by the Expo
    window-inspection app to get real localised defects from a YOLO model.
    """
    raw = await file.read()
    return _run_yolo(raw)


def _run_yolo(image_bytes: bytes) -> DefectsResponse:
    if not yolo_available():
        return DefectsResponse(
            defects=[],
            count=0,
            image_width=0,
            image_height=0,
            model="unavailable",
            model_loaded=False,
        )

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR) if cv2 is not None else None
    if bgr is None:
        # cv2 unavailable or decode failed
        return DefectsResponse(
            defects=[],
            count=0,
            image_width=0,
            image_height=0,
            model="yolov8s-cardd",
            model_loaded=False,
        )

    h, w = bgr.shape[:2]
    raw_dets = detect_defects(bgr)

    # Sort top-to-bottom, left-to-right and assign stable ids.
    band_h = max(16, h // 24)
    raw_dets.sort(key=lambda d: (d[1] // band_h, d[0]))

    out: List[YoloDefectOut] = []
    for i, (x, y, bw, bh, conf, raw_name, defect_type, severity) in enumerate(raw_dets, start=1):
        out.append(
            YoloDefectOut(
                id=i,
                type=defect_type,
                raw_class=raw_name,
                severity=severity,
                confidence=round(conf, 4),
                x=x,
                y=y,
                width=bw,
                height=bh,
            )
        )

    return DefectsResponse(
        defects=out,
        count=len(out),
        image_width=int(w),
        image_height=int(h),
        model="yolov8s-cardd",
        model_loaded=True,
    )


# ============================================================================
# Legacy contour-based pallet detection (kept for backward compatibility)
# ============================================================================


# --- Tunable constants ---
MIN_BOX_AREA_RATIO = 0.0005
MAX_BOX_AREA_RATIO = 0.40
ASPECT_RATIO_MIN = 0.3
ASPECT_RATIO_MAX = 3.5
SOLIDITY_MIN = 0.60
CANNY_LOW = 30
CANNY_HIGH = 100
CANNY_DILATE_ITERS = 2
ADAPTIVE_BLOCK = 41
ADAPTIVE_C = 8
ADAPTIVE_CLOSE_ITERS = 2
MORPH_CLOSE_KERNEL = (7, 7)
MORPH_OPEN_KERNEL = (3, 3)
ANOMALY_DEVIATION_PCT = 15
NMS_OVERLAP = 0.3


def analyze_pallet(image_bytes: bytes) -> AnalyzeResponse:
    if cv2 is None:
        return _empty_response(0, 0)

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return _empty_response(0, 0)

    h, w = bgr.shape[:2]
    img_area = w * h

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    equalised = clahe.apply(gray)
    blurred = cv2.GaussianBlur(equalised, (5, 5), 0)

    all_boxes: List[Tuple[int, int, int, int]] = []
    all_boxes.extend(_detect_edges(blurred, img_area))
    all_boxes.extend(_detect_threshold(blurred, img_area, cv2.THRESH_BINARY))
    all_boxes.extend(_detect_threshold(blurred, img_area, cv2.THRESH_BINARY_INV))
    all_boxes.extend(_detect_gradient(blurred, img_area))

    if not all_boxes:
        all_boxes.extend(_detect_edges(blurred, img_area, low=15, high=60, iters=3))

    if not all_boxes:
        return _empty_response(w, h)

    all_boxes = _non_max_suppression(all_boxes, NMS_OVERLAP)
    if not all_boxes:
        return _empty_response(w, h)

    widths = np.array([b[2] for b in all_boxes])
    heights = np.array([b[3] for b in all_boxes])
    std_w = int(round(float(np.median(widths))))
    std_h = int(round(float(np.median(heights))))
    std_area_val = std_w * std_h

    anomalies: List[Anomaly] = []
    items: List[DetectedItem] = []
    for i, (x, y, bw, bh) in enumerate(all_boxes, start=1):
        ba = bw * bh
        deviation = int(round(abs(ba - std_area_val) / max(std_area_val, 1) * 100))
        if deviation >= ANOMALY_DEVIATION_PCT:
            anomalies.append(Anomaly(id=i, x=int(x), y=int(y), width=int(bw), height=int(bh), deviation=deviation))
        else:
            items.append(DetectedItem(id=i, x=int(x), y=int(y), width=int(bw), height=int(bh)))

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


def _detect_edges(
    gray: np.ndarray,
    img_area: int,
    low: int = CANNY_LOW,
    high: int = CANNY_HIGH,
    iters: int = CANNY_DILATE_ITERS,
) -> List[Tuple[int, int, int, int]]:
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
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, thresh_type, ADAPTIVE_BLOCK, ADAPTIVE_C,
    )
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, MORPH_CLOSE_KERNEL)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, close_kernel, iterations=ADAPTIVE_CLOSE_ITERS)
    open_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_OPEN_KERNEL)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, open_kernel, iterations=1)
    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return _filter_rectangular_contours(contours, img_area)


def _detect_gradient(
    gray: np.ndarray,
    img_area: int,
) -> List[Tuple[int, int, int, int]]:
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)
    _, binary = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dilated = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)), iterations=3)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return _filter_rectangular_contours(contours, img_area)


def _filter_rectangular_contours(
    contours: list,
    img_area: int,
) -> List[Tuple[int, int, int, int]]:
    min_area = img_area * MIN_BOX_AREA_RATIO
    max_area = img_area * MAX_BOX_AREA_RATIO
    results: List[Tuple[int, int, int, int]] = []
    for c in contours:
        contour_area = cv2.contourArea(c)
        if contour_area < min_area or contour_area > max_area:
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        box_area = bw * bh
        if box_area < 1:
            continue
        aspect = bw / max(bh, 1)
        if aspect < ASPECT_RATIO_MIN or aspect > ASPECT_RATIO_MAX:
            continue
        if contour_area / box_area < SOLIDITY_MIN:
            continue
        peri = cv2.arcLength(c, closed=True)
        approx = cv2.approxPolyDP(c, 0.04 * peri, closed=True)
        vertices = len(approx)
        if vertices == 4:
            results.append((int(x), int(y), int(bw), int(bh)))
        elif 5 <= vertices <= 8 and contour_area / box_area > 0.75:
            results.append((int(x), int(y), int(bw), int(bh)))
    return results


def _non_max_suppression(
    boxes: List[Tuple[int, int, int, int]], overlap_thresh: float
) -> List[Tuple[int, int, int, int]]:
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


def _render_annotated(
    bgr: np.ndarray,
    boxes: List[Tuple[int, int, int, int]],
    anomalies: List[Anomaly],
    std_w: int,
    std_h: int,
    img_w: int,
    img_h: int,
) -> str:
    out = bgr.copy()
    anomaly_ids = {a.id for a in anomalies}
    line_thickness = max(3, int(round(min(img_w, img_h) * 0.003)))
    font_scale = max(0.45, min(img_w, img_h) * 0.0006)
    for i, (x, y, bw, bh) in enumerate(boxes, start=1):
        if i in anomaly_ids:
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 0, 255), line_thickness)
            cx, cy = x + bw // 2, y + bh // 2
            cv2.circle(out, (cx, cy), max(6, line_thickness * 2), (0, 0, 255), -1)
            cv2.putText(out, f"#{i}", (x + 5, y + max(16, int(font_scale * 30))),
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 255),
                        max(1, line_thickness // 2), cv2.LINE_AA)
        else:
            overlay = out.copy()
            cv2.rectangle(overlay, (x, y), (x + bw, y + bh), (0, 220, 80), -1)
            cv2.addWeighted(overlay, 0.12, out, 0.88, 0, out)
            cv2.rectangle(out, (x, y), (x + bw, y + bh), (0, 230, 70), line_thickness)
    ref_text = f"Std: {std_w}x{std_h} px"
    cv2.putText(out, ref_text, (14, max(28, int(font_scale * 40))),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.9, (255, 255, 255),
                max(1, line_thickness // 2), cv2.LINE_AA)
    count_text = f"Items: {len(boxes)}  Anomalies: {len(anomaly_ids)}"
    (tw, th), _ = cv2.getTextSize(count_text, cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.85, max(1, line_thickness // 2))
    cv2.rectangle(out, (img_w - tw - 22, 6), (img_w - 6, th + 18), (30, 30, 30), -1)
    cv2.putText(out, count_text, (img_w - tw - 14, th + 12),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale * 0.85, (255, 255, 255),
                max(1, line_thickness // 2), cv2.LINE_AA)
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
