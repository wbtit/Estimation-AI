import os
import sys
import time
import main
from pdf2image import convert_from_path

def run_test():
    pdf_path = sys.argv[1]
    print(f"Loading {pdf_path}...")
    pages = convert_from_path(pdf_path, dpi=200, grayscale=True)
    
    # Save pages locally for testing
    page_files = []
    for i, page in enumerate(pages):
        page_path = f"test_page-{i+1}.png"
        page.save(page_path, 'PNG')
        page_files.append(page_path)
    
    tier1_count = 0
    tier2_count = 0
    results = []
    start_time = time.time()
    
    os.environ["OCR_ENGINE"] = "easyocr"
    
    class DummyRequest:
        def __init__(self, path, pdf_path, page_num):
            self.image_path = path
            self.pdf_path = pdf_path
            self.page_number = page_num
            
    for i, p in enumerate(page_files):
        body = DummyRequest(p, pdf_path, i + 1)
        res = main.classify_sheet(body)
        
        c_type = res.get("sheet_type", "unknown")
        c_conf = res.get("confidence", 0.0)
        c_sched = res.get("detected_schedule_present", False)
        c_tier = res.get("tier", 2)
        c_text = res.get("matched_text", "")
        
        if c_tier == 1:
            tier1_count += 1
        else:
            tier2_count += 1
            
        results.append((i+1, c_type, c_conf, c_sched, c_tier, c_text))
        
    for p in page_files:
        os.remove(p)
        
    dur = time.time() - start_time
    print("\n\n=== RE-TEST RESULTS ===")
    print(f"{'Page':<5} | {'Type':<18} | {'Conf':<4} | {'Schedule':<8} | {'Tier':<4} | {'Matched Text'}")
    print("-" * 80)
    for r in results:
        matched = r[5].replace('\n', ' ') if r[5] else 'N/A'
        print(f"{r[0]:<5} | {r[1]:<18} | {r[2]:<4.2f} | {str(r[3]):<8} | {r[4]:<4} | {matched[:50]}")
        
    print(f"\nCompleted in {dur:.2f}s")
    print(f"Tier 1: {tier1_count}, Tier 2: {tier2_count}")

if __name__ == '__main__':
    run_test()
