import psycopg2
import redis
import json
import uuid

def queue():
    conn = psycopg2.connect("postgresql://admin:new_password@127.0.0.1:5432/Structural_DB")
    cur = conn.cursor()
    
    r = redis.Redis(host='localhost', port=6379, db=0)

    jobs = [
        {'id': 'a2b1cd51-bf47-4dbf-88ca-60dabf23dbf0', 'filename': 'THOREAU.pdf'},
        {'id': '9f85d00c-84f1-4e08-b827-64e578319d28', 'filename': 'VA MEDICAL CENTER.pdf'},
        {'id': '35b90421-926d-40d5-9382-6795e0df6399', 'filename': 'STS RAPHAEL.pdf'}
    ]

    for job in jobs:
        job_id = job['id']
        filename = job['filename']
        file_path = f"/home/user/swe/steel-platform/jobs/{job_id}/upload.pdf"
        
        cur.execute("INSERT INTO jobs (id, filename, file_path, status, created_at) VALUES (%s, %s, %s, 'queued', NOW())", (job_id, filename, file_path))
        
        # BullMQ format for add
        job_data = {
            "name": "process",
            "data": {
                "jobId": job_id,
                "pdfPath": file_path
            },
            "opts": {
                "jobId": job_id
            }
        }
        
        # BullMQ relies on lua scripts, but we can just use the BullMQ REST API? 
        # No, it's easier to just use the JS script but run it correctly.
        pass
    
    conn.commit()

if __name__ == "__main__":
    queue()
