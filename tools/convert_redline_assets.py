"""Bake author geometry to a small renderer-independent, fully embedded mesh library.
Run prepare_redline_assets.cjs first. Requires numpy and Pillow; never runs in the game.
"""
from pathlib import Path
import numpy as np,json,struct,base64,io,gzip
from PIL import Image
root=Path(__file__).resolve().parents[1]
def b64(a,typ):return base64.b64encode(np.asarray(a,dtype=typ).tobytes()).decode()
class GLB:
 def __init__(self,name):
  b=(root/'.cache'/f'{name}-decoded.glb').read_bytes();l=struct.unpack_from('<I',b,12)[0];self.g=json.loads(b[20:20+l]);self.bin=b[28+l:];self.world={};self.parents={}
  for i,n in enumerate(self.g['nodes']):
   for j in n.get('children',[]):self.parents[j]=i
 def accessor(self,i):
  a=self.g['accessors'][i];v=self.g['bufferViews'][a['bufferView']];dt=np.dtype({5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',dt.itemsize*k);out=np.ndarray((a['count'],k),dtype=dt,buffer=self.bin,offset=off,strides=(stride,dt.itemsize)).copy()
  if a.get('normalized'):out=np.maximum(out.astype(float)/np.iinfo(dt).max,-1)
  return out
 def matrix(self,i):
  if i in self.world:return self.world[i]
  n=self.g['nodes'][i];x,y,z,w=n.get('rotation',[0,0,0,1]);m=np.eye(4);m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(n.get('scale',[1,1,1]));m[:3,3]=n.get('translation',[0,0,0]);m=np.array(n['matrix']).reshape(4,4).T if 'matrix'in n else m
  if i in self.parents:m=self.matrix(self.parents[i])@m
  self.world[i]=m;return m
 def image(self,texture):
  t=self.g['textures'][texture];im=self.g['images'][t.get('extensions',{}).get('EXT_texture_webp',{}).get('source',t.get('source'))];v=self.g['bufferViews'][im['bufferView']];return Image.open(io.BytesIO(self.bin[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGBA')
 def children(self,i):
  out=[]
  for j in self.g['nodes'][i].get('children',[]):out+=[j]+self.children(j)
  return out
 def primitive(self,i,p,toLocal):
  m=toLocal@self.matrix(i);pos=self.accessor(p['attributes']['POSITION']);v=(np.column_stack([pos,np.ones(len(pos))])@m.T)[:,:3];n=self.accessor(p['attributes']['NORMAL'])@np.linalg.inv(m[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-10);uv=self.accessor(p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0'in p['attributes'] else np.zeros((len(v),2));ix=self.accessor(p['indices']).reshape(-1,3).astype(int)
  # Babylon left-handed front-face orientation: invert glTF's baked orientation.
  if np.linalg.det(m[:3,:3])>0:ix=ix[:,[0,2,1]]
  return {'p':v,'n':n,'uv':uv,'ix':ix,'mat':p['material']}
textures=[];materials=[];texCache={}
def material(glb,idx,key):
 m=glb.g['materials'][idx];p=m.get('pbrMetallicRoughness',{});name=m.get('name','');paint=(key=='pack' and name.startswith('Body')) or (key=='gtr' and ('Paint_'in name or 'Coloured_'in name));glass=('Glass'in name or 'Window'in name);data={'name':name,'paint':paint,'glass':glass,'factor':p.get('baseColorFactor',[1,1,1,1]),'metal':p.get('metallicFactor',1),'rough':p.get('roughnessFactor',1)}
 for field,param,gray in [('map','baseColorTexture',paint),('orm','metallicRoughnessTexture',False)]:
  if param not in p:continue
  tid=p[param]['index'];tk=(key,tid,gray)
  if tk not in texCache:
   im=glb.image(tid);im.thumbnail((512,512))
   if gray:
    a=np.array(im);rgb=a[:,:,:3].astype(float);maxi=rgb.max(2);mini=rgb.min(2);mask=(maxi-mini>maxi*.13)&(maxi>25);val=np.clip(maxi*1.05,0,255);rgb[mask]=val[mask,None];a[:,:,:3]=rgb.astype('u1');im=Image.fromarray(a)
   f=io.BytesIO();im.save(f,format='WEBP',quality=90);texCache[tk]=len(textures);textures.append('data:image/webp;base64,'+base64.b64encode(f.getvalue()).decode())
  data[field]=texCache[tk]
 if paint:data['factor']=[1,1,1,1]
 materials.append(data);return len(materials)-1

def encode(parts,wheels,name):
 allp=np.concatenate([p['p'] for p in parts]);lo=allp.min(0);hi=allp.max(0);center=(lo+hi)/2;center[1]=lo[1];dim=hi-lo
 # Canonical coordinates normalized independently; target vehicles use their own dimensions.
 for p in parts:p['p']=(p['p']-center)/dim;p['n']=p['n']*dim;p['n']/=np.maximum(np.linalg.norm(p['n'],axis=1)[:,None],1e-10)
 for w in wheels:w['center']=((w['center']-center)/dim).tolist()
 return {'name':name,'dimensions':dim.tolist(),'wheels':wheels,'parts':[{'p':b64(p['p'],'<f4'),'n':b64(p['n'],'<f4'),'uv':b64(p['uv'],'<f4'),'ix':b64(p['ix'],'<u4'),'material':p['mat'],'wheel':p.get('wheel',-1),'fixed':p.get('fixed',False)} for p in parts]}

pack=GLB('car-pack');matmap={i:material(pack,i,'pack') for i in range(len(pack.g['materials']))}
bodies=[i for i,n in enumerate(pack.g['nodes']) if n.get('name','').lower().endswith('body')];wheelNodes=[i for i,n in enumerate(pack.g['nodes']) if n.get('name','').startswith('Wheel') and 'mesh'not in n]
wheelAssignments={i:[] for i in bodies}
for w in wheelNodes:
 pos=pack.matrix(w)[:3,3];body=min(bodies,key=lambda i:np.linalg.norm((pos-pack.matrix(i)[:3,3])[[0,2]]));wheelAssignments[body].append(w)
models={}
for body in bodies:
 name=pack.g['nodes'][body]['name'].split()[0].lower();local=np.linalg.inv(pack.matrix(body));parts=[]
 for node in pack.children(body):
  if 'mesh'not in pack.g['nodes'][node]:continue
  for prim in pack.g['meshes'][pack.g['nodes'][node]['mesh']]['primitives']:parts.append(pack.primitive(node,prim,local))
 # Detect the rear from red pixels on actual optical surfaces. No guessing based on roof placement.
 reds=[]
 for p in parts:
  if 'Optics' not in pack.g['materials'][p['mat']].get('name',''):continue
  ti=pack.g['materials'][p['mat']]['pbrMetallicRoughness'].get('baseColorTexture');
  if not ti:continue
  im=np.array(pack.image(ti['index']));u=(p['uv'][:,0]*im.shape[1]).astype(int)%im.shape[1];v=(p['uv'][:,1]*im.shape[0]).astype(int)%im.shape[0];rgb=im[v,u,:3].astype(float);mask=(rgb[:,0]>rgb[:,1]*1.5)&(rgb[:,0]>rgb[:,2]*1.5)&(rgb[:,0]>80);reds.extend(p['p'][mask].tolist())
 transform=np.eye(3)
 wheels=[]
 for wi,w in enumerate(wheelAssignments[body]):
  wp=[]
  for node in pack.children(w):
   if 'mesh'not in pack.g['nodes'][node]:continue
   for prim in pack.g['meshes'][pack.g['nodes'][node]['mesh']]['primitives']:
    p=pack.primitive(node,prim,local);p['wheel']=wi;wp.append(p['p']);parts.append(p)
  pts=np.concatenate(wp);wheels.append({'center':(pts.min(0)+pts.max(0))/2})
 wheelcenters=np.array([w['center'] for w in wheels]);_,vec=np.linalg.eigh(np.cov(wheelcenters[:,:2].T));forward=vec[:,-1];rear=np.mean(reds,axis=0)[:2]-wheelcenters[:,:2].mean(0) if reds else np.array([0,1]);forward*=(-1 if np.dot(rear,forward)>0 else 1);fx,fy=forward;transform=np.array([[-fy,fx,0],[0,0,1],[fx,fy,0]]);sign=fy
 for w in wheels:w['center']=w['center']@transform.T
 for p in parts:
  p['p']=p['p']@transform.T;p['n']=p['n']@transform.T;p['mat']=matmap[p['mat']]
  if np.linalg.det(transform)<0:p['ix']=p['ix'][:,[0,2,1]]
 models[name]=encode(parts,wheels,name);print(name,'rear-sign',-sign,'wheels',len(wheels),'dimensions',models[name]['dimensions'])
# Detailed track car; remove badges/plate, classify disconnected wheel triangles into four assemblies.
gtr=GLB('gt-r34');gm={i:material(gtr,i,'gtr') for i in range(len(gtr.g['materials']))};parts=[]
for i,n in enumerate(gtr.g['nodes']):
 if 'mesh'not in n:continue
 for prim in gtr.g['meshes'][n['mesh']]['primitives']:
  mn=gtr.g['materials'][prim['material']]['name']
  if any(x in mn for x in ['Badge','ManufacturerPlate']):continue
  p=gtr.primitive(i,prim,np.eye(4));p['wheelish']=prim['material']<=13;p['fixed']=prim['material']<=2;parts.append(p)
rear=np.mean(np.concatenate([p['p'] for p in parts if gtr.g['materials'][p['mat']]['name']=='red_glass']),axis=0)[2];sign=-1 if rear>0 else 1;transform=np.diag([1,1,sign]);new=[]
for p in parts:
 p['p']=p['p']@transform;p['n']=p['n']@transform
 if sign<0:p['ix']=p['ix'][:,[0,2,1]]
 if p['wheelish']:
  mid=p['p'][p['ix']].mean(1)
  for wi,(sx,sz) in enumerate([(-1,-1),(-1,1),(1,-1),(1,1)]):
   ix=p['ix'][(mid[:,0]*sx>0)&(mid[:,2]*sz>0)]
   if len(ix):new.append({**p,'ix':ix,'wheel':wi})
 else:new.append(p)
parts=new;wheels=[]
for wi in range(4):
 pts=np.concatenate([p['p'][np.unique(p['ix'])] for p in parts if p.get('wheel')==wi]);wheels.append({'center':(pts.min(0)+pts.max(0))/2})
for p in parts:p['mat']=gm[p['mat']]
models['gtr']=encode(parts,wheels,'gtr');print('gtr',models['gtr']['dimensions'], 'rear sign',-sign)
# Strip unused vertices from split parts; gzip is embedded and decoded once at boot.
for model in models.values():
 for p in model['parts']:
  ix=np.frombuffer(base64.b64decode(p['ix']),dtype='<u4');unique,inverse=np.unique(ix,return_inverse=True)
  for key,k in [('p',3),('n',3),('uv',2)]:p[key]=b64(np.frombuffer(base64.b64decode(p[key]),dtype='<f4').reshape(-1,k)[unique],'<f4')
  p['ix']=b64(inverse,'<u4')
# Repair damaged paint normals from the optimized track-car copy, welding UV seams
# while retaining hard creases. Geometry/UVs remain those of the licensed model.
for part in models['gtr']['parts']:
 if not materials[part['material']]['paint']:continue
 pos=np.frombuffer(base64.b64decode(part['p']),dtype='<f4').reshape(-1,3).astype(float);ix=np.frombuffer(base64.b64decode(part['ix']),dtype='<u4').reshape(-1,3)
 face=-np.cross(pos[ix[:,1]]-pos[ix[:,0]],pos[ix[:,2]]-pos[ix[:,0]]);areas=np.linalg.norm(face,axis=1);unit=face/np.maximum(areas[:,None],1e-12);local=np.zeros_like(pos)
 for k in range(3):np.add.at(local,ix[:,k],face)
 local/=np.maximum(np.linalg.norm(local,axis=1)[:,None],1e-12);groups={};keys=[tuple(v) for v in np.round(pos,5)]
 for fi,t in enumerate(ix):
  for vi in t:groups.setdefault(keys[vi],set()).add(fi)
 normal=np.zeros_like(pos)
 for i,key in enumerate(keys):
  faces=np.array(list(groups.get(key,[])),dtype=int)
  if len(faces):
   use=faces[(unit[faces]@local[i])>.5];normal[i]=face[use].sum(0) if len(use) else local[i]
 normal/=np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-12);part['n']=b64(normal,'<f4')
output={'models':models,'materials':materials,'textures':textures};data=json.dumps(output,separators=(',',':')).encode();(root/'assets/redline/meshes.json.gz').write_bytes(gzip.compress(data,compresslevel=9,mtime=0));print('ASSET LIBRARY',len(data),'gzip',len(gzip.compress(data)))
