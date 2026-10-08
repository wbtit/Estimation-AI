"""Phase 5c item 2a, extra: are there drawn markers (small filled single-item shapes of 6 to 10 pt) ON a
shared line that would cut it between members? Counts only.

usage (from worker/):  PYTHONPATH=. .venv/bin/python ../scripts/calibration/phase5c_shared_markers.py <job> <project id>
"""
import sys, json, math, collections, urllib.request, importlib.util
import pymupdf
sys.path.insert(0,'.')
spec=importlib.util.spec_from_file_location('sl','../scripts/calibration/phase5c_shared_lines.py'); sl=importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)
job, pid = sys.argv[1], sys.argv[2]
get=sl.get
sheets={s['id']:s for s in get(f"/api/projects/{pid}/sheets")['sheets']}
members=[m for m in get(f"/api/projects/{pid}/members")['members'] if m['link']['line'] and m['bbox']]
groups=collections.defaultdict(list)
for m in members: groups[(m['sheet_id'], sl.key(m['link']['line']))].append(m)
shared={k:v for k,v in groups.items() if len(v)>1}
doc=pymupdf.open(sl.pdf_of(job))
by_page=collections.defaultdict(list)
for (sid,_),v in shared.items(): by_page[sheets[sid]['page_index']].append(v)
st=collections.Counter()
for pidx, items in by_page.items():
    page=doc[pidx]; m_=page.rotation_matrix
    small=[]
    for d in page.get_cdrawings():
        r=pymupdf.Rect(d['rect'])*m_; r.normalize()
        if d.get('type')=='f' and 6<=max(r.width,r.height)<=10 and len(d['items'])==1:
            small.append(((r.x0+r.x1)/2,(r.y0+r.y1)/2,max(r.width,r.height)))
    for v in items:
        ln=v[0]['link']['line']; L=(ln['p'][0],ln['p'][1],ln['q'][0],ln['q'][1])
        ang=sl.ang_of(L); ux,uy=math.cos(ang),math.sin(ang)
        o=(L[0],L[1]); proj=lambda x,y:(x-o[0])*ux+(y-o[1])*uy
        tend=proj(L[2],L[3]); lo,hi=min(0,tend),max(0,tend)
        pts=sorted(proj(x,y) for x,y,s in small if sl.dist_point_seg(x,y,L)<=3.0 and lo+3<=proj(x,y)<=hi-3)
        cuts=[]
        for t in pts:
            if not cuts or t-cuts[-1]>14: cuts.append(t)
        slots=collections.defaultdict(list)
        for i,m in enumerate(v):
            b=m['bbox']; t=proj((b['x0']+b['x1'])/2,(b['y0']+b['y1'])/2)
            slots[sum(1 for c in cuts if c<t)].append(i)
        st['shared lines']+=1
        st['markers (cut points) found on the line']+=len(cuts)
        st['members']+=len(v)
        st['members alone between cut points']+=sum(1 for ix in slots.values() if len(ix)==1)
        st['members sharing a stretch']+=sum(len(ix) for ix in slots.values() if len(ix)>1)
        if all(len(ix)==1 for ix in slots.values()): st['lines fully separated by markers']+=1
        if not cuts: st['lines with no marker']+=1
print(job, dict(st))
