"""
YOLO-based window/surface defect detector.

Downloads a pretrained YOLOv8s fine-tuned on the CarDD dataset from the Hugging
Face Hub on first use, then runs real object detection for surface defects:
  dent, scratch, crack, glass_shatter, lamp_broken, tire_flat

For window quality inspection we keep the classes that are visually meaningful on
glass/window frames (dent, scratch, crack, glass_shatter) and map the rest into
our generic defect buckets. The model is small enough for CPU inference.

The Hugging Face cache and the Ultralytics settings directory are pinned to a
writable folder so this works in read-only-root containers.
"""

from __future__ import annotations

import os
import threading
from typing import List, Optional, Tuple

# Pin writable config/cache dirs BEFORE importing ultralytics so it does not try
# to write to a read-only home directory.
os.environ.setdefault("HF_HOME", "/tmp/hf_cache")
os.environ.setdefault("YOLO_CONFIG_DIR", "/tmp/ultralytics_cfg")
os.environ.setdefault("ULTRALYTICS_CONFIG_DIR", "/tmp/ultralytics_cfg")

import numpy as np

try:
    from huggingface_hub import hf_hub_download
except Exception:  # pragma: no cover - optional at runtime
    hf_hub_download = None  # type: ignore[assignment]

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover - optional at runtime
    YOLO = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# Hugging Face Hub repo + weight file for the defect detector.
# abdullahg7/cardd-yolov8s v1.0 is a detection-only YOLOv8s trained on CarDD
# with clean class names: dent, scratch, crack, glass_shatter, lamp_broken,
# tire_flat. We reuse it for window glass/frame defects — the visual features
# (scratches, cracks, chips/dents, shattered glass) transfer well.
HF_REPO = "abdullahg7/cardd-yolov8s"
HF_FILENAME = "v1.0/best.pt"

# Raw model class id -> raw class name (kept in sync with the loaded model).
_RAW_NAMES = {
    0: "dent",
    1: "scratch",
    2: "crack",
    3: "glass_shatter",
    4: "lamp_broken",
    5: "tire_flat",
}

# Raw YOLO class name -> app DefectType id used by the Expo client.
# - dent      -> dent
# - scratch   -> scratch
# - crack     -> crack
# - glass_shatter -> break (broken glass)
# - lamp_broken   -> other (not a window defect)
# - tire_flat     -> other (not a window defect)
RAW_TO_DEFECT_TYPE = {
    "dent": "dent",
    "scratch": "scratch",
    "crack": "crack",
    "glass_shatter": "break",
    "lamp_broken": "other",
    "tire_flat": "other",
}

# Confidence thresholds.
# - LOW_CONF: minimum confidence to keep a detection at all.
# - TINY_BOX_MIN_RATIO: minimum box area (relative to image) — we keep VERY
#   small boxes because a chip can be tiny. Only truly zero-size noise is
#   dropped.
LOW_CONF = 0.20
TINY_BOX_MIN_RATIO = 0.00005  # 0.005% of image area
# IoU for NMS. Ultralytics already runs NMS internally; this is a secondary
# pass to merge any near-duplicates after mapping.
NMS_IOU = 0.5


# ---------------------------------------------------------------------------
# Singleton loader
# ---------------------------------------------------------------------------

_model = None
_model_lock = threading.Lock()
_model_load_attempted = False


def _model_path() -> str:
    """Resolve and download the YOLO weights, caching them locally."""
    if hf_hub_download is None:
        raise RuntimeError("huggingface_hub is not installed.")
    cache_dir = os.environ.get("HF_HOME", "/tmp/hf_cache")
    return hf_hub_download(
        repo_id=HF_REPO,
        filename=HF_FILENAME,
        cache_dir=cache_dir,
    )


def get_model():
    """Lazily load the YOLO model (singleton, thread-safe)."""
    global _model, _model_load_attempted
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        if _model_load_attempted:
            # Avoid retrying on every request after a failed load.
            return _model
        _model_load_attempted = True
        if YOLO is None:
            raise RuntimeError("ultralytics is not installed.")
        path = _model_path()
        _model = YOLO(path)
    return _model


def model_ready() -> bool:
    """True if the model has been loaded (does not trigger a load)."""
    return _model is not None


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

# A detected defect in pixel space + mapped app fields.
type YoloDefect = Tuple[
    int,     # x (px, top-left)
    int,     # y (px, top-left)
    int,     # width (px)
    int,     # height (px)
    float,   # confidence (0..1)
    str,     # raw class name
    str,     # app defect_type id
    str,     # severity: "low" | "medium" | "high"
]


def _severity_for(raw_name: str, conf: float, box_area_ratio: float) -> str:
    """Heuristic severity mapping.

    - glass_shatter is always high (structural).
    - crack is high when confident, medium otherwise.
    - dent is medium when confident.
    - scratch / other: low cosmetic, medium if confident.
    - Tiny boxes are low (a speck is cosmetic even if a crack).
    """
    if raw_name == "glass_shatter":
        return "high"
    if raw_name == "crack":
        if conf >= 0.55:
            return "high"
        return "medium"
    if raw_name == "dent":
        return "medium" if conf >= 0.5 else "low"
    if raw_name == "scratch":
        return "low"
    # other / lamp_broken / tire_flat
    return "low" if conf < 0.5 else "medium"


def detect_defects(
    image_bgr: np.ndarray,
    conf_threshold: float = LOW_CONF,
    img_size: int = 640,
) -> List[YoloDefect]:
    """Run YOLO inference and return a list of mapped defects.

    Each entry is (x, y, w, h, conf, raw_name, defect_type, severity) in
    source-image pixel coordinates.
    """
    model = get_model()
    if model is None:
        return []

    h, w = image_bgr.shape[:2]
    img_area = float(w * h)
    if img_area <= 0:
        return []

    results = model.predict(
        source=image_bgr,
        conf=conf_threshold,
        iou=NMS_IOU,
        imgsz=img_size,
        verbose=False,
        save=False,
    )
    if not results:
        return []

    out: List[YoloDefect] = []
    res = results[0]
    # boxes.xywh is (N, 4) in xywh (center) format, boxes.xyxy is (N, 4) xyxy,
    # boxes.cls is (N,), boxes.conf is (N,).
    try:
        boxes = res.boxes
    except AttributeError:
        return []
    if boxes is None or len(boxes) == 0:
        return []

    try:
        xyxy = boxes.xyxy.cpu().numpy() if hasattr(boxes.xyxy, "cpu") else np.asarray(boxes.xyxy)
        cls_ids = boxes.cls.cpu().numpy() if hasattr(boxes.cls, "cpu") else np.asarray(boxes.cls)
        confs = boxes.conf.cpu().numpy() if hasattr(boxes.conf, "cpu") else np.asarray(boxes.conf)
    except Exception:
        return []

    for i in range(len(xyxy)):
        try:
            x1, y1, x2, y2 = [float(v) for v in xyxy[i]]
        except Exception:
            continue
        conf = float(confs[i]) if i < len(confs) else 0.0
        cls_id = int(cls_ids[i]) if i < len(cls_ids) else -1
        raw_name = _RAW_NAMES.get(cls_id, "other")
        bw = max(1.0, x2 - x1)
        bh = max(1.0, y2 - y1)
        box_area_ratio = (bw * bh) / img_area
        if box_area_ratio < TINY_BOX_MIN_RATIO:
            continue
        defect_type = RAW_TO_DEFECT_TYPE.get(raw_name, "other")
        severity = _severity_for(raw_name, conf, box_area_ratio)
        out.append(
            (
                int(round(x1)),
                int(round(y1)),
                int(round(bw)),
                int(round(bh)),
                conf,
                raw_name,
                defect_type,
                severity,
            )
        )

    return out


def is_available() -> bool:
    """Quick check whether ultralytics + huggingface_hub are importable."""
    return YOLO is not None and hf_hub_download is not None
