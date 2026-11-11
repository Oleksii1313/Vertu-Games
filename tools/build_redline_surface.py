"""Bake welded road/ground/curb surfaces. This mesh is also the runtime collision-height source."""
from pathlib import Path
import subprocess,json,numpy as np,math,base64,gzip,hashlib
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from shapely import affinity
from scipy.spatial import cKDTree
import mapbox_earcut as earcut
root=Path(__file__).resolve().parents[1]
roads=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./games/redline-roads.js')().roads))"],cwd=root))
lines=[LineString([(p['x'],p['z']) for p in r['points']]) for r in roads]
polys=[l.buffer(r['width']/2,quad_segs=4,cap_style=2,join_style=1) for r,l in zip(roads,lines)]
asphalt=unary_union(polys);city=unary_union(polys[:18]);roadbeds=unary_union([l.buffer(r['width']/2+6,quad_segs=4,cap_style=2,join_style=1) for r,l in zip(roads,lines)])
def at(ri,s):
 r=roads[ri];s=max(0,min(s,r['total']-.001));i=max(0,np.searchsorted(r['cum'],s,side='right')-1);a,b=r['points'][i:i+2];f=(s-r['cum'][i])/(r['cum'][i+1]-r['cum'][i]);return np.array([a['x']+(b['x']-a['x'])*f,a['z']+(b['z']-a['z'])*f]),math.atan2(b['x']-a['x'],b['z']-a['z'])
# Reserved activity plots: car parks, freight yards, roadside cafés. Connected to the real road.
lots=[];pads=[];drives=[]
for ri,s,side,kind in [(1,175,-1,'service'),(0,200,1,'parking'),(4,240,1,'freight'),(2,180,-1,'cafe'),(13,110,1,'parking'),(14,170,-1,'cafe'),(16,210,1,'parking'),(6,190,1,'harbour'),(17,190,-1,'market'),(8,280,1,'parking')]:
 p,yaw=at(ri,s);normal=np.array([math.cos(yaw),-math.sin(yaw)]);w,d=46,30;center=p+normal*(roads[ri]['width']/2+d/2+8)*side
 shape=affinity.rotate(box(-w/2,-d/2,w/2,d/2),-yaw*180/math.pi+90,origin=(0,0));shape=affinity.translate(shape,*center)
 if not box(-790,-640,790,560).contains(shape) or shape.distance(asphalt)<4:continue
 pad=shape;drive=LineString([p,center]).buffer(3.8,cap_style=2);pads.append(pad);drives.append(drive);lots.append(dict(x=float(center[0]),z=float(center[1]),w=w,d=d,yaw=yaw-math.pi/2,kind=kind,entry=dict(x=float(p[0]),z=float(p[1])),roadId=ri))
# Known forecourts retain original story/service positions.
forecourts=[box(-482,-442.5,-448,-397.5),box(16.5,398,71.5,442)]
asphalt=unary_union([asphalt,*pads,*drives,*forecourts]);city=unary_union([city,*pads,*drives,*forecourts]);roadbeds=unary_union([roadbeds,city.buffer(5,quad_segs=3)])
sidewalk=city.buffer(3.7,quad_segs=4).difference(asphalt.buffer(.15,quad_segs=3)).difference(unary_union(drives+forecourts).buffer(1))
# A continuous verge fills all the way to the terrain edge; no floating ribbon edges.
shoulder=roadbeds.difference(asphalt)
ground=box(-1000,-2300,1200,590).difference(roadbeds)
A=[];D=[];Y=[];DY=[];WIDTH=[]
for r in roads:
 for a,b in zip(r['points'],r['points'][1:]):A.append([a['x'],a['z']]);D.append([b['x']-a['x'],b['z']-a['z']]);Y.append(a['y']);DY.append(b['y']-a['y']);WIDTH.append(r['width'])
A=np.array(A);D=np.array(D);Y=np.array(Y);DY=np.array(DY);WIDTH=np.array(WIDTH);lens=np.sum(D*D,axis=1);tree=cKDTree(A+D*.5)
def roadfield(points):
 p=np.array(points);_,ix=tree.query(p,k=12);ap=p[:,None,:]-A[ix];t=np.clip(np.sum(ap*D[ix],axis=2)/lens[ix],0,1);vec=ap-D[ix]*t[:,:,None];dist=np.sqrt(np.sum(vec*vec,axis=2));best=dist.argmin(1);rows=np.arange(len(p));ids=ix[rows,best];return (Y[ids]+DY[ids]*t[rows,best]),dist[rows,best],WIDTH[ids]
def raw(points):
 x,z=np.array(points).T;v=np.clip((-z-650)/900,0,1);v=v*v*(3-2*v);return v*(135+75*np.exp(-((x+140)/750)**2)+27*np.sin(z*.003)+18*np.cos(x*.004+z*.002))
def heights(points,kind):
 y,dist,width=roadfield(points)
 if kind=='asphalt':return y+.06
 if kind=='sidewalk':return y+.20
 if kind=='shoulder':return y+.06-.095*np.clip((dist-width/2)/6,0,1)
 t=np.clip((dist-width/2-6)/75,0,1);t=t*t*(3-2*t);return (y-.035)*(1-t)+(raw(points)-.07)*t

def polygons(p):
 if p.is_empty:return []
 if p.geom_type=='Polygon':return[p]
 return [q for q in getattr(p,'geoms',[]) if q.geom_type=='Polygon']
def pack(a,dt):return base64.b64encode(np.asarray(a,dtype=dt).tobytes()).decode()
cells=[];tile=40;stats={};geo={'asphalt':asphalt,'sidewalk':sidewalk,'shoulder':shoulder,'terrain':ground}
for kind,shape in geo.items():
 minx,minz,maxx,maxz=shape.bounds;count=0
 for x in range(math.floor(minx/tile)*tile,math.ceil(maxx/tile)*tile,tile):
  for z in range(math.floor(minz/tile)*tile,math.ceil(maxz/tile)*tile,tile):
   clip=shape.intersection(box(x,z,x+tile,z+tile));verts=[];indices=[]
   for poly in polygons(clip):
    if poly.area<.02:continue
    rings=[list(poly.exterior.coords)[:-1]]+[list(r.coords)[:-1] for r in poly.interiors];coords=np.array([p for r in rings for p in r]);ends=np.cumsum([len(r) for r in rings],dtype=np.uint32);ix=earcut.triangulate_float64(coords,ends);off=len(verts);verts.extend(coords.tolist());indices.extend((ix+off).tolist())
   if not indices:continue
   v=np.array(verts);h=heights(v,kind);pos=np.column_stack([v[:,0],h,v[:,1]]);eps=.5;dx=(heights(v+[eps,0],kind)-heights(v-[eps,0],kind))/(eps*2);dz=(heights(v+[0,eps],kind)-heights(v-[0,eps],kind))/(eps*2);normal=np.column_stack([-dx,np.ones(len(v)),-dz]);normal/=np.linalg.norm(normal,axis=1)[:,None];ix=np.array(indices).reshape(-1,3)
   # Upward-facing triangles in Babylon's left-handed coordinate system.
   a,b,c=pos[ix[:,0]],pos[ix[:,1]],pos[ix[:,2]];cross=np.cross(b-a,c-a);flip=cross[:,1]>0;ix[flip]=ix[flip][:,[0,2,1]]
   cells.append(dict(x=x,z=z,kind=kind,p=pack(pos,'<f4'),n=pack(normal,'<f4'),ix=pack(ix,'<u4')));count+=len(ix)
 stats[kind]=count;print(kind,count,'triangles')
# Road edge paint follows the union boundary, not every overlapping road strip.
edge=asphalt.buffer(-.65,quad_segs=3).difference(asphalt.buffer(-.80,quad_segs=3));markings=[]
for p in polygons(edge):
 rings=[list(p.exterior.coords)[:-1]]+[list(r.coords)[:-1] for r in p.interiors];coords=np.array([a for r in rings for a in r]);ix=earcut.triangulate_float64(coords,np.cumsum([len(r) for r in rings],dtype=np.uint32));y=heights(coords,'asphalt')+.018;markings.append(dict(p=pack(np.column_stack([coords[:,0],y,coords[:,1]]),'<f4'),ix=pack(ix,'<u4')))
# Intersections between curving roads, even if they are not an explicit graph node.
crossings=[]
for i in range(len(polys)):
 for j in range(i):
  for p in polygons(polys[i].intersection(polys[j])):
   if p.area>20:crossings.append({'x':p.centroid.x,'z':p.centroid.y,'r':max(14,math.sqrt(p.area/math.pi)+5)})
curbEdges=[]
for poly in polygons(sidewalk):
 for ring in [poly.exterior,*poly.interiors]:curbEdges.append(list(ring.coords))
data={'curbEdges':curbEdges,'tile':tile,'cells':cells,'markings':markings,'lots':lots,'crossings':crossings,'stats':stats,'roadsHash':hashlib.sha256((root/'games/redline-roads.js').read_bytes()).hexdigest()};data=json.dumps(data,separators=(',',':')).encode();out=root/'assets/redline/surface.json.gz';out.write_bytes(gzip.compress(data,compresslevel=9,mtime=0));print('SURFACE',len(cells),'cells',len(lots),'plots',len(data),'bytes, gzip',out.stat().st_size)
