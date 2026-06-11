"""
PalletPro inspection backend (FastAPI).

This is a reference backend for the PalletPro mobile app. The mobile client sends
a captured pallet image to `POST /api/analyze` and receives item counts, the
standard item size, detected anomalies, and a confidence score.

The current implementation uses a lightweight OpenCV contour pipeline as a
placeholder. Swap `analyze_pallet` with a YOLOv8 model when you are ready
(see the TODO markers below).

Run locally:
    pip install fastapi "uvicorn[standard]" opencv-python-headless numpy python-multipart
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Point the app at this server by setting in expo/.env:
    EXPO_PUBLIC_ANALYZE_API_URL=http://<your-lan-ip>:8000
"""

from __future__ import annotations

import io
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    import cv2  # type: ignore
    HAS_CV2 = True
except Exception:  # pragma: no cover - OpenCV optional at import time
    HAS_CV2 = False

app = FastAPI(title="PalletPro API", version="1.0.0")

# Allow the mobile app (any origin in dev) to reach the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    annotated_image_url: str
    image_width: int
    image_height: int


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "opencv": HAS_CV2}


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    raw = await file.read()
    return analyze_pallet(raw)


def analyze_pallet(image_bytes: bytes) -> AnalyzeResponse:
    """
    Detect items on a pallet face and flag anomalies.

    TODO (production):
      - Replace this OpenCV heuristic with a YOLOv8 detector:
            from ultralytics import YOLO
            model = YOLO("pallet_items.pt")
            results = model.predict(image)
      - Use the detected boxes to compute the standard size (median area) and
        flag boxes whose area deviates beyond a tolerance threshold.
      - Render an annotated image, upload it, and return its URL in
        `annotated_image_url`.
    """
    if not HAS_CV2:
        # Minimal fallback if OpenCV is unavailable.
        return AnalyzeResponse(
            count=0,
            average_width=0,
            average_height=0,
            anomalies=[],
            items=[],
            confidence=0,
            annotated_image_url="",
            image_width=0,
            image_height=0,
        )

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    height, width = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes: List[tuple[int, int, int, int]] = []
    min_area = (width * height) * 0.0006
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h >= min_area and 0.3 < (w / max(h, 1)) < 3.5:
            boxes.append((x, y, w, h))

    if not boxes:
        return AnalyzeResponse(
            count=0,
            average_width=0,
            average_height=0,
            anomalies=[],
            items=[],
            confidence=60,
            annotated_image_url="",
            image_width=width,
            image_height=height,
        )

    widths = np.array([b[2] for b in boxes])
    heights = np.array([b[3] for b in boxes])
    std_w = int(np.median(widths))
    std_h = int(np.median(heights))
    std_area = std_w * std_h

    anomalies: List[Anomaly] = []
    items: List[DetectedItem] = []
    for i, (x, y, w, h) in enumerate(boxes, start=1):
        area = w * h
        deviation = int(abs(area - std_area) / max(std_area, 1) * 100)
        if deviation >= 15:
            anomalies.append(
                Anomaly(id=i, x=x, y=y, width=w, height=h, deviation=deviation)
            )
        else:
            items.append(DetectedItem(id=i, x=x, y=y, width=w, height=h))

    confidence = max(70, min(99, 100 - len(anomalies)))

    return AnalyzeResponse(
        count=len(boxes),
        average_width=std_w,
        average_height=std_h,
        anomalies=anomalies,
        items=items,
        confidence=confidence,
        annotated_image_url="",
        image_width=width,
        image_height=height,
    )
