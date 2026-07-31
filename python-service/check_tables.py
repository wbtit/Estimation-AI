import pdfplumber
import sys

def test_pages(pdf_path, pages):
    with pdfplumber.open(pdf_path) as pdf:
        for p in pages:
            page = pdf.pages[p - 1]
            tables = page.find_tables()
            print(f"\n--- Page {p} ---")
            pw, ph = page.width, page.height
            for t in tables:
                x0, y0, x1, y1 = t.bbox
                if (x1 - x0) > 0.9 * pw and (y1 - y0) > 0.9 * ph:
                    continue
                if len(t.rows) >= 3:
                    extracted = t.extract()
                    text_flat = " ".join([str(c).upper() for r in extracted[:3] for c in r if c])
                    print(f"Table bbox {t.bbox}: text_flat='{text_flat[:100]}...'")

if __name__ == "__main__":
    test_pages(sys.argv[1], [2, 10, 11, 15, 19, 21, 22, 24])
