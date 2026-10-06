import gc
import os
import psutil
from easyocr import Reader
import numpy as np

def get_memory_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024

def measure():
    print(f"Base memory: {get_memory_mb():.1f} MB")
    
    # Initialize reader
    reader = Reader(['en'], gpu=False)
    print(f"Memory after EasyOCR init (at rest): {get_memory_mb():.1f} MB")
    
    # Create a 36x48 at 300 DPI dummy image (10800 x 14400 RGB)
    # Wait, creating this might crash if it's too big! Let's do 8.5x11 (2550 x 3300) first to get base numbers
    img_letter = np.zeros((3300, 2550, 3), dtype=np.uint8)
    print(f"Memory with Letter image loaded: {get_memory_mb():.1f} MB")
    
    # Run OCR on letter
    reader.readtext(img_letter)
    print(f"Memory after Letter OCR: {get_memory_mb():.1f} MB")
    
    # Now try architectural (36x48)
    try:
        img_arch = np.zeros((14400, 10800, 3), dtype=np.uint8)
        print(f"Memory with Architectural image loaded: {get_memory_mb():.1f} MB")
        reader.readtext(img_arch)
        print(f"Memory after Architectural OCR: {get_memory_mb():.1f} MB")
    except Exception as e:
        print(f"Error during Architectural OCR: {e}")

if __name__ == "__main__":
    measure()
