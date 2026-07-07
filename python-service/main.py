from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import os
import shutil
import logging
from pdf2image import convert_from_path

app = FastAPI(title="Steel Drawing Microservice")

if not shutil.which("pdftoppm"):
    logging.error("CRITICAL: poppler-utils is not installed. PDF rasterization will fail. Please install poppler-utils (e.g., 'apt-get install poppler-utils').")


# ── Request models ────────────────────────────────────────────────────────────

class RasterizeRequest(BaseModel):
    pdf_path: str
    dpi: Optional[int] = 300

class ClassifyRequest(BaseModel):
    image_path: str

class ScheduleRequest(BaseModel):
    image_path: str
    pdf_path: str
    page_number: int

class DetectRequest(BaseModel):
    image_path: str

class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float

class OcrRequest(BaseModel):
    image_path: str
    bbox: BBox


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Stage 1: Rasterize ────────────────────────────────────────────────────────

@app.post("/rasterize")
def rasterize(body: RasterizeRequest):
    job_dir = os.path.dirname(body.pdf_path)
    pages_dir = os.path.join(job_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    
    pages = convert_from_path(body.pdf_path, dpi=body.dpi or 300)
    result = []
    
    for i, page in enumerate(pages):
        path = os.path.join(pages_dir, f"page_{i+1}.png")
        page.save(path, "PNG")
        result.append({
            "page_number": i + 1,
            "image_path": path,
            "width": page.width,
            "height": page.height
        })
        
    return { "pages": result }


# ── Stage 2: Classify sheet ───────────────────────────────────────────────────

SHEET_TYPE_KEYWORDS = {
    "framing_plan":      ["FRAMING PLAN", "FL. PLAN", "FLOOR FRAMING"],
    "member_schedule":   ["SCHEDULE", "MEMBER LIST", "BEAM SCHEDULE"],
    "elevation":         ["ELEVATION", "ELEV"],
    "section":           ["SECTION", "SECT"],
    "connection_detail": ["CONNECTION", "DETAIL", "TYP. CONN"],
    "general_notes":     ["GENERAL NOTES", "SPECIFICATIONS", "NOTES"],
}

@app.post("/classify-sheet")
def classify_sheet(body: ClassifyRequest):
    """
    TODO: Replace stub with YOLOv8 classifier once model is trained.
    Keyword fallback is used here for bootstrap.
    """
    filename = os.path.basename(body.image_path).lower()

    # Infer sheet type from filename convention (stub heuristic)
    if "schedule" in filename:
        sheet_type, confidence = "member_schedule", 0.85
    elif "plan" in filename:
        sheet_type, confidence = "framing_plan", 0.85
    elif "elev" in filename:
        sheet_type, confidence = "elevation", 0.80
    elif "section" in filename:
        sheet_type, confidence = "section", 0.80
    else:
        # Default: alternate between framing_plan and member_schedule for stub
        page_num = 1
        try:
            page_num = int(filename.split("page_")[1].split(".")[0])
        except Exception:
            pass
        sheet_type = "member_schedule" if page_num == 1 else "framing_plan"
        confidence = 0.70

    return {
        "sheet_type": sheet_type,
        "confidence": confidence,
        "title_block_text": f"STUB TITLE BLOCK — {sheet_type.upper()}",
    }


# ── Stage 3: Extract member schedule ─────────────────────────────────────────

@app.post("/extract-schedule")
def extract_schedule(body: ScheduleRequest):
    """
    TODO: Replace stub with:
        pdfplumber for native PDFs
        img2table + easyocr for scanned PDFs
    """
    return {
        "source": "stub",
        "rows": [
            {"mark_number": "B1", "designation": "W18X35",  "quantity": 8,  "length_ft": 24.0, "remarks": ""},
            {"mark_number": "B2", "designation": "W16X26",  "quantity": 12, "length_ft": 20.0, "remarks": ""},
            {"mark_number": "G1", "designation": "W24X55",  "quantity": 4,  "length_ft": 32.0, "remarks": 'CAMBER 3/4"'},
            {"mark_number": "C1", "designation": "HSS6X6X3/8", "quantity": 6, "length_ft": 14.0, "remarks": ""},
        ],
    }


# ── Stage 4: YOLOv8 detection ─────────────────────────────────────────────────

@app.post("/detect")
def detect(body: DetectRequest):
    """
    TODO: Replace stub with:
        from ultralytics import YOLO
        detector = YOLO("models/structural_detector.pt")
        results = detector(body.image_path, conf=0.40, imgsz=1280, device='cpu')
    """
    return {
        "detections": [
            # Two member callouts
            {"class_name": "member_callout", "confidence": 0.91, "bbox": {"x": 0.32, "y": 0.45, "w": 0.08, "h": 0.03}},
            {"class_name": "member_callout", "confidence": 0.87, "bbox": {"x": 0.55, "y": 0.60, "w": 0.08, "h": 0.03}},
            # Grid bubbles
            {"class_name": "grid_bubble",    "confidence": 0.97, "bbox": {"x": 0.10, "y": 0.12, "w": 0.02, "h": 0.02}},
            {"class_name": "grid_bubble",    "confidence": 0.95, "bbox": {"x": 0.35, "y": 0.12, "w": 0.02, "h": 0.02}},
            {"class_name": "grid_bubble",    "confidence": 0.96, "bbox": {"x": 0.60, "y": 0.12, "w": 0.02, "h": 0.02}},
            {"class_name": "grid_bubble",    "confidence": 0.94, "bbox": {"x": 0.05, "y": 0.45, "w": 0.02, "h": 0.02}},
            {"class_name": "grid_bubble",    "confidence": 0.93, "bbox": {"x": 0.05, "y": 0.65, "w": 0.02, "h": 0.02}},
            # Dimension line
            {"class_name": "dimension_line", "confidence": 0.88, "bbox": {"x": 0.32, "y": 0.20, "w": 0.25, "h": 0.01}},
            # Section marker with cross-ref
            {"class_name": "section_marker", "confidence": 0.82, "bbox": {"x": 0.70, "y": 0.30, "w": 0.03, "h": 0.03}},
        ]
    }


# ── Stage 5: OCR a bounding box region ───────────────────────────────────────

STUB_OCR_RESPONSES = [
    {
        "raw_text": "W18X35",
        "ocr_confidence": 0.94,
        "parsed": {"shape_type": "W", "designation": "W18X35", "depth_in": 18.0, "weight_per_foot": 35.0},
        "parse_success": True,
    },
    {
        "raw_text": "W24X55",
        "ocr_confidence": 0.91,
        "parsed": {"shape_type": "W", "designation": "W24X55", "depth_in": 24.0, "weight_per_foot": 55.0},
        "parse_success": True,
    },
]

_ocr_call_count = 0

@app.post("/ocr")
def ocr_region(body: OcrRequest):
    """
    TODO: Replace stub with:
        from PIL import Image
        import easyocr
        reader = easyocr.Reader(['en'], gpu=False)
        crop the bbox region, run reader.readtext(), parse callout
    """
    global _ocr_call_count
    response = STUB_OCR_RESPONSES[_ocr_call_count % len(STUB_OCR_RESPONSES)]
    _ocr_call_count += 1
    return response
