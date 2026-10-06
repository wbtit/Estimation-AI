import psycopg2
import sys

def generate_report(job_ids):
    conn = psycopg2.connect("postgresql://admin:new_password@127.0.0.1:5432/Structural_DB")
    cur = conn.cursor()

    # Scope to explicitly provided job IDs that are successfully completed
    job_ids_tuple = tuple(job_ids)
    
    # 0. Check data integrity (NULL sheet_type)
    cur.execute("""
        SELECT COUNT(*) FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.sheet_type IS NULL;
    """, (job_ids_tuple,))
    null_pages = cur.fetchone()[0]

    # 1. Total pages processed, and sheet_type distribution
    cur.execute("""
        SELECT p.sheet_type, COUNT(*) FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.sheet_type IS NOT NULL
        GROUP BY p.sheet_type ORDER BY count DESC;
    """, (job_ids_tuple,))
    distribution = cur.fetchall()
    
    cur.execute("""
        SELECT count(*) FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.sheet_type IS NOT NULL;
    """, (job_ids_tuple,))
    total_pages = cur.fetchone()[0]

    # 2. Every page classified as "unknown"
    cur.execute("""
        SELECT p.page_number, j.filename, p.title_block_text, p.matched_candidate_text, p.anchor_match_type, p.resolving_tier
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.sheet_type = 'unknown'
        ORDER BY j.filename, p.page_number;
    """, (job_ids_tuple,))
    unknown_pages = cur.fetchall()

    # 3. Tier 2 fallback count
    cur.execute("""
        SELECT j.filename, COUNT(p.id)
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.resolving_tier = 2
        GROUP BY j.filename
        ORDER BY count DESC;
    """, (job_ids_tuple,))
    tier2_counts = cur.fetchall()

    # 4. Confidence distribution
    cur.execute("""
        SELECT j.filename, p.page_number, p.sheet_type, p.sheet_type_confidence, p.matched_candidate_text
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.sheet_type_confidence < 0.80
        ORDER BY p.sheet_type_confidence ASC;
    """, (job_ids_tuple,))
    low_confidence = cur.fetchall()

    # 5. detected_schedule_present count per PDF, and any page with >1 region
    cur.execute("""
        SELECT j.filename, COUNT(p.id)
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.detected_schedule_present = true
        GROUP BY j.filename;
    """, (job_ids_tuple,))
    schedule_counts = cur.fetchall()

    cur.execute("""
        SELECT j.filename, p.page_number, jsonb_array_length(p.detected_schedule_regions) as regions
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.detected_schedule_present = true AND jsonb_array_length(p.detected_schedule_regions) > 1
        ORDER BY j.filename, p.page_number;
    """, (job_ids_tuple,))
    multi_schedule_regions = cur.fetchall()

    # 6. Any page where needs_review = true
    cur.execute("""
        SELECT j.filename, p.page_number, p.needs_review, p.review_reason
        FROM pages p
        JOIN jobs j ON p.job_id = j.id
        WHERE j.id IN %s AND (j.status = 'review_ready' OR j.status = 'done')
        AND p.needs_review = true
        ORDER BY j.filename, p.page_number;
    """, (job_ids_tuple,))
    review_pages = cur.fetchall()

    # 7. Total processing time per PDF
    cur.execute("""
        SELECT filename, EXTRACT(EPOCH FROM (updated_at - processing_started_at)) as duration_sec
        FROM jobs
        WHERE id IN %s AND (status = 'review_ready' OR status = 'done')
        ORDER BY duration_sec DESC;
    """, (job_ids_tuple,))
    durations = cur.fetchall()

    print("=== BATCH AGGREGATE SUMMARY ===\n")
    print(f"Data Integrity Check: {null_pages} pages have a NULL sheet_type (ghost pages).\n")
    print(f"Total pages successfully processed: {total_pages}\n")
    print("1. Sheet Type Distribution:")
    for row in distribution:
        print(f"  - {row[0]}: {row[1]}")
    
    print("\n2. Unknown Pages (Manual Review Needed):")
    if not unknown_pages:
        print("  None")
    for row in unknown_pages:
        print(f"  - PDF: {row[1]}, Page: {row[0]}, Title: '{row[2]}', Matched: '{row[3]}', Anchor: {row[4]}, Tier: {row[5]}")

    print("\n3. Tier 2 Fallback Count (Full-page OCR required):")
    if not tier2_counts:
        print("  None")
    for row in tier2_counts:
        print(f"  - {row[0]}: {row[1]} pages")

    print("\n4. Low Confidence (< 0.80):")
    if not low_confidence:
        print("  None")
    for row in low_confidence:
        print(f"  - PDF: {row[0]}, Page: {row[1]} | Type: {row[2]} | Conf: {row[3]:.2f} | Matched: '{row[4]}'")

    print("\n5. Detected Schedules:")
    print("  Counts per PDF:")
    for row in schedule_counts:
        print(f"    - {row[0]}: {row[1]}")
    print("\n  Pages with >1 region:")
    if not multi_schedule_regions:
        print("    None")
    for row in multi_schedule_regions:
        print(f"    - PDF: {row[0]}, Page: {row[1]} | Regions: {row[2]}")

    print("\n6. Pages Needs Review (Unclassified Fallback):")
    if not review_pages:
        print("  None")
    for row in review_pages:
        print(f"  - PDF: {row[0]}, Page: {row[1]} | Reason: {row[3]}")

    print("\n7. True Processing Time per PDF:")
    for row in durations:
        if row[1] is not None:
            print(f"  - {row[0]}: {row[1]:.1f} seconds")
        else:
            print(f"  - {row[0]}: N/A (processing_started_at missing)")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 generate_batch_report.py <job_id_1> <job_id_2> ...")
        sys.exit(1)
    
    generate_report(sys.argv[1:])
