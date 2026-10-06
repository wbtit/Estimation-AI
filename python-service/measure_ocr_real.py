import gc
import os
import psutil
from easyocr import Reader
import numpy as np
from PIL import Image

def get_memory_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024

def measure():
    print(f"Base memory: {get_memory_mb():.1f} MB")
    
    # Initialize reader
    reader = Reader(['en'], gpu=False)
    print(f"Memory after EasyOCR init (at rest): {get_memory_mb():.1f} MB")
    
    # Load actual page
    img_path = '/home/user/swe/steel-platform/jobs/a2b1cd51-bf47-4dbf-88ca-60dabf23dbf0/pages/page_1.png'
    img = np.array(Image.open(img_path).convert('RGB'))
    print(f"Memory with Architectural image loaded (shape {img.shape}): {get_memory_mb():.1f} MB")
    
    # Run OCR
    try:
        reader.readtext(img)
        print(f"Memory after Architectural OCR: {get_memory_mb():.1f} MB")
    except Exception as e:
        print(f"Error during Architectural OCR: {e}")

if __name__ == "__main__":
    measure()
