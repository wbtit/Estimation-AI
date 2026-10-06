import psycopg2
import time
import sys

def wait_for_jobs():
    conn = psycopg2.connect("postgresql://admin:new_password@127.0.0.1:5432/Structural_DB")
    cur = conn.cursor()
    
    print("Waiting for batch 1 to complete...")
    start_time = time.time()
    
    while True:
        cur.execute("SELECT id, filename, status FROM jobs WHERE filename != 'upload.pdf'")
        rows = cur.fetchall()
        
        pending = 0
        for row in rows:
            status = row[2]
            if status in ['queued', 'processing']:
                pending += 1
                
        if pending == 0:
            print(f"All jobs finished! Took {time.time() - start_time:.1f}s")
            break
            
        time.sleep(10)
        
    conn.close()

if __name__ == "__main__":
    wait_for_jobs()
