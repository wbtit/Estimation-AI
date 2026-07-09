import os
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class OCREngine:
    def detect_text(self, image) -> List[Dict[str, Any]]:
        raise NotImplementedError

class EasyOCREngine(OCREngine):
    def __init__(self):
        import easyocr
        logger.info("Initializing EasyOCR engine...")
        self.reader = easyocr.Reader(['en'], gpu=False)

    def detect_text(self, image) -> List[Dict[str, Any]]:
        # image should be a numpy array or path
        results = self.reader.readtext(image)
        output = []
        for res in results:
            # res: ([[x1, y1], [x2, y2], [x3, y3], [x4, y4]], text, confidence)
            bbox = res[0]
            xs = [pt[0] for pt in bbox]
            ys = [pt[1] for pt in bbox]
            x, y = min(xs), min(ys)
            w, h = max(xs) - x, max(ys) - y
            output.append({
                "text": res[1],
                "bbox": [float(x), float(y), float(w), float(h)],
                "confidence": float(res[2])
            })
        return output

class PaddleOCREngine(OCREngine):
    def __init__(self):
        from paddleocr import PaddleOCR
        logger.info("Initializing PaddleOCR engine...")
        self.ocr = PaddleOCR(use_angle_cls=False, lang='en', show_log=False)

    def detect_text(self, image) -> List[Dict[str, Any]]:
        # image should be a numpy array or path
        results = self.ocr.ocr(image, cls=False)
        output = []
        if not results or not results[0]:
            return output
        for res in results[0]:
            if res is None:
                continue
            # res: [[[x1, y1], [x2, y2], [x3, y3], [x4, y4]], (text, confidence)]
            bbox = res[0]
            xs = [pt[0] for pt in bbox]
            ys = [pt[1] for pt in bbox]
            x, y = min(xs), min(ys)
            w, h = max(xs) - x, max(ys) - y
            output.append({
                "text": res[1][0],
                "bbox": [float(x), float(y), float(w), float(h)],
                "confidence": float(res[1][1])
            })
        return output

_engine = None

def get_engine() -> OCREngine:
    global _engine
    if _engine is None:
        engine_name = os.environ.get("OCR_ENGINE", "easyocr").lower()
        if engine_name == "paddleocr":
            _engine = PaddleOCREngine()
        else:
            _engine = EasyOCREngine()
    return _engine
