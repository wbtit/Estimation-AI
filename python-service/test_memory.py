import resource
import os

def get_mem():
    # ru_maxrss is in kilobytes on Linux
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

def print_mem(label):
    print(f"{label}: {get_mem():.2f} MB")

print_mem("Initial")

import easyocr
print_mem("After import easyocr")

reader = easyocr.Reader(['en'], gpu=False)
print_mem("After loading reader (at rest)")

import numpy as np
img = np.random.randint(0, 255, (3300, 2550, 3), dtype=np.uint8)
print_mem("After allocating dummy 300DPI image (8.5x11)")

result = reader.readtext(img)
print_mem("After OCR")

