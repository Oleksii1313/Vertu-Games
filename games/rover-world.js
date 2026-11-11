import * as T from 'three';
import {makeResident} from './rover-characters.js';
// Deterministic settlements and instanced biome vegetation; no downloaded assets.
export function populateAurelia({scene,elevation,biomeAt,folks,nodes,solids,label,tr}){
 const root=new T.Group();root.name='Aurelia landscape';scene.add(root);
 let seed=938217;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const stats={villages:10,houses:0,trees:0,shrubs:0,flowers:0,camps:0,locals:20};
 const mats=new Map(),boxG=new T.BoxGeometry(1,1,1),ballG=new T.IcosahedronGeometry(1,1),cylG=new T.CylinderGeometry(.72,1,1,7),coneG=new T.ConeGeometry(1,1,9);
 const material=c=>{if(!mats.has(c))mats.set(c,new T.MeshStandardMaterial({color:c,roughness:.92}));return mats.get(c)};
 function mesh(g,geo,c,x,y,z,sx=1,sy=1,sz=1){const o=new T.Mesh(geo,material(c));o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;g.add(o);return o}
 const box=(g,x,y,z,w,h,d,c)=>mesh(g,boxG,c,x,y,z,w,h,d);
 const cyl=(g,x,y,z,r,h,c)=>mesh(g,cylG,c,x,y,z,r,h,r);
 function sphere(g,x,y,z,xr,yr,zr,c){return mesh(g,ballG,c,x,y,z,xr,yr,zr)}
 const chunks=new Map(),instances=new Map(),dummy=new T.Object3D();
 function chunk(x,z){const k=Math.floor(x/100)+','+Math.floor(z/100);if(!chunks.has(k)){const g=new T.Group();g.userData.center=new T.Vector2(Math.floor(x/100)*100+50,Math.floor(z/100)*100+50);root.add(g);chunks.set(k,g)}return chunks.get(k)}
 function instance(geo,c,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){const g=chunk(x,z),key=g.uuid+':'+geo.uuid+':'+c;if(!instances.has(key))instances.set(key,{g,geo,c,list:[]});dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();instances.get(key).list.push(dummy.matrix.clone())}
 function branch(x,y,z,dx,dy,dz,r,c){const len=Math.hypot(dx,dy,dz),dir=new T.Vector3(dx,dy,dz).normalize(),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),dir),e=new T.Euler().setFromQuaternion(q);instance(cylG,c,x+dx/2,y+dy/2,z+dz/2,r,len,r,e.x,e.y,e.z)}
 function roadDistance(x,z){let d=Infinity;for(const n of folks){const l=n.x*n.x+n.z*n.z,f=T.MathUtils.clamp((x*n.x+z*n.z)/l,0,1);d=Math.min(d,Math.hypot(x-n.x*f,z-n.z*f))}return d}
 const gravelCanvas=document.createElement('canvas');gravelCanvas.width=gravelCanvas.height=128;const gravel=gravelCanvas.getContext('2d');gravel.fillStyle='#f3f0e8';gravel.fillRect(0,0,128,128);for(let i=0;i<1700;i++){const q=Math.sin(i*127.1+3.3)*43758.5453,r=Math.sin(i*311.7+1.2)*19141.37;gravel.fillStyle=i%3?'#b7ad9730':'#ffffff55';gravel.fillRect((q-Math.floor(q))*128,(r-Math.floor(r))*128,1+i%2,1)}const gravelTex=new T.CanvasTexture(gravelCanvas);gravelTex.colorSpace=T.SRGBColorSpace;gravelTex.wrapS=gravelTex.wrapT=T.RepeatWrapping;const roadMats=new Map();
 function strip(parent,ax,az,bx,bz,width,c){const len=Math.hypot(bx-ax,bz-az);if(len<.05)return;const nx=-(bz-az)/len*width/2,nz=(bx-ax)/len*width/2,steps=Math.ceil(len/2),p=[],uv=[],idx=[];for(let i=0;i<=steps;i++){const f=i/steps,x=ax+(bx-ax)*f,z=az+(bz-az)*f;for(const side of [-1,1]){const px=x+side*nx,pz=z+side*nz;p.push(px,elevation(px,pz)+.055,pz);uv.push(side===1?1:0,f*len/3)}if(i<steps){const j=i*2;idx.push(j,j+1,j+2,j+1,j+3,j+2)}}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();if(!roadMats.has(c))roadMats.set(c,new T.MeshStandardMaterial({color:c,map:gravelTex,roughness:1}));const m=new T.Mesh(geo,roadMats.get(c));m.receiveShadow=true;parent.add(m)}
 const roads=new T.Group();root.add(roads);for(const n of folks)strip(roads,0,0,n.x,n.z,4.7,0xb9aa89);
 // Village names describe their region, while existing customers retain their IDs.
 const names=[['Листовая роща','Leafgrove'],['Янтарный ключ','Amber Spring'],['Тихая мельница','Quiet Mill'],['Ивовая заводь','Willow Reach'],['Медный двор','Copper Yard'],['Северный очаг','Northern Hearth'],['Облачный перевал','Cloud Pass'],['Грибная долина','Mushroom Vale'],['Сад рассвета','Dawn Orchard'],['Кварцевый берег','Quartz Shore']];
 const towns=[],locals=[],props=[];
 const roofShape=new T.Shape();roofShape.moveTo(-2.7,0);roofShape.lineTo(0,1.6);roofShape.lineTo(2.7,0);roofShape.closePath();const roofG=new T.ExtrudeGeometry(roofShape,{depth:4.9,bevelEnabled:false});roofG.translate(0,0,-2.45);
 function freeHouse(x,z,r){return Math.hypot(x,z-17)>9&&roadDistance(x,z)>r+2.5&&!nodes.some(n=>Math.hypot(x-n.x,z-n.z)<r+2.4)&&!solids.some(o=>Math.hypot(x-o.x,z-o.z)<r+o.r+.6)}
 function house(parent,x,z,angle,i,biome){const y=elevation(x,z),g=new T.Group();g.position.set(x,y,z);g.rotation.y=angle;parent.add(g);const cold=biome==='frost',wall=[0xe6d7b9,0xd4c5a2,0xc8d1bb][i%3],roof=cold?0x9eb6b8:biome==='canyon'?0xa6745d:[0x647f6c,0x9e7060,0x777d88][i%3];
  box(g,0,-.25,0,4.8,1.1,4.6,0x8e9180);box(g,0,1.8,0,4.5,3.6,4.2,wall);mesh(g,roofG,roof,0,3.55,0);box(g,1.32,4.45,-.65,.58,2.5,.65,0x898a7a);box(g,1.32,5.67,-.65,.78,.17,.85,0xbbb6a0);
  box(g,0,1.22,2.13,.98,2.45,.12,0x456c61);box(g,0,2.52,2.23,1.25,.12,.22,0x9d8768);sphere(g,.33,1.15,2.24,.055,.055,.055,0xd7b87c);box(g,0,.10,2.54,1.6,.2,.9,0xaba78e);
  for(const side of [-1,1]){box(g,side*1.38,1.98,2.14,.98,1.13,.10,0x4f7070);box(g,side*1.38,1.98,2.205,.77,.89,.03,0xe0c98e);box(g,side*1.38,1.98,2.25,.05,1.05,.04,0x657b6b);box(g,side*1.38,1.98,2.25,.9,.05,.04,0x657b6b);box(g,side*1.38,1.35,2.3,1.1,.19,.30,0x807e62);for(let j=0;j<3;j++)sphere(g,side*1.38+(j-1)*.27,1.51,2.32,.18,.16,.18,0x859972)}
  box(g,0,.55,-2.15,4.55,.12,.09,0xa99777);for(const side of [-1,1])box(g,side*2.2,1.8,2.15,.12,3.5,.13,0xb3a88c);
  solids.push({x,z,r:3.15,h:5.6,kind:'house'});stats.houses++;return g;
 }
 function lamp(parent,x,z){const y=elevation(x,z);cyl(parent,x,y+1.4,z,.065,2.8,0x657567);box(parent,x,y+2.85,z,.42,.5,.42,0xe9d49c);box(parent,x,y+3.15,z,.56,.13,.56,0x526c61)}
 function bench(parent,x,z){const y=elevation(x,z);box(parent,x,y+.48,z,2,.15,.65,0x9d8260);box(parent,x,y+.93,z-.26,2,.65,.1,0x9d8260);for(const s of [-1,1])box(parent,x+s*.72,y+.22,z,.13,.52,.58,0x677264)}
 function farm(parent,x,z){strip(parent,x-3,z,x+3,z,4.4,0x8e7a5a);for(const s of [-1,1])for(let j=0;j<5;j++){const px=x-3+j*1.5,pz=z+s*2.35,py=elevation(px,pz);cyl(parent,px,py+.5,pz,.055,1.15,0x9f8c69);if(j<4){const ny=elevation(px+1.5,pz);const rail=box(parent,px+.75,(py+ny)/2+.65,pz,1.52,.09,.09,0xb4a07a);rail.rotation.z=Math.atan2(ny-py,1.5)}}for(let j=0;j<18;j++){const px=x-2.5+(j%6),pz=z-1.5+Math.floor(j/6)*1.4,y=elevation(px,pz);sphere(parent,px,y+.21,pz,.29,.25,.31,0x76915e);if(j%2===0)sphere(parent,px,y+.38,pz,.13,.12,.13,0xd58f5b)}}
 for(const n of folks){const town=new T.Group();town.name=names[n.id][1];scene.add(town);towns.push(town);const biome=biomeAt(n.x,n.z),c=biome==='frost'?0xc4ccbe:0xc5b898;
  strip(town,n.x-7,n.z+2,n.x+7,n.z+2,10,c);
  const slots=[[-10,-8],[0,-14],[10,-8],[-16,3],[16,3],[-12,15],[12,15],[-23,-12],[23,-12],[0,22]];let count=0;
  for(let j=0;j<slots.length&&count<7;j++){const [dx,dz]=slots[j],x=n.x+dx,z=n.z+dz;if(!freeHouse(x,z,3.1))continue;house(town,x,z,Math.atan2(-dx,-dz),n.id+j,biome);strip(town,n.x,n.z+2,x,z,1.45,c);count++}
  // Market awning behind the original order-giving resident.
  const x=n.x,z=n.z-1,y=elevation(x,z);box(town,x,y+.9,z,3.6,.15,1.15,0xa58a61);for(const side of [-1,1]){cyl(town,x+side*1.85,y+1.4,z,.06,2.8,0x8c8162);box(town,x+side*1.5,y+.42,z,.11,.85,.8,0x7a755b)}
  for(let j=0;j<8;j++){const aw=box(town,x-1.75+j*.5,y+2.8,z, .5,.09,2.3,j%2?0xefe1bd:0xb47e65);aw.rotation.x=.12}
  for(let j=0;j<6;j++){box(town,x-1.4+j*.56,y+1.02,z,.45,.22,.64,0x8e7857);for(let k=0;k<3;k++)sphere(town,x-1.5+j*.56+k*.12,y+1.2,z,.10,.1,.12,[0xc88256,0xb8b279,0x87946b][j%3])}
  label(tr(...names[n.id]).toUpperCase(),town,x,y+3.8,z,5.3);label(n.name,town,x+2.8,elevation(x+2.8,z+2)+1.6,z+2,1.6);
  const wx=n.x-5,wz=n.z+2,wy=elevation(wx,wz);const well=mesh(town,new T.TorusGeometry(.65,.18,6,16),0xa9ab98,wx,wy+.55,wz);well.rotation.x=Math.PI/2;const water=mesh(town,new T.CircleGeometry(.6,16),0x6c9d9c,wx,wy+.32,wz);water.rotation.x=-Math.PI/2;for(const s of [-1,1])cyl(town,wx+s*.8,wy+1.25,wz,.06,2.5,0x847d5d);box(town,wx,wy+2.25,wz,1.8,.12,.15,0x847d5d);
  for(const s of [-1,1]){bench(town,n.x+s*6,n.z+7);lamp(town,n.x+s*7,n.z-3);farm(town,n.x+s*22,n.z+9)}
  for(let j=0;j<2;j++){const g=makeResident((n.species+j+1)%8,n.id+j),x=n.x+(j?4:-4),z=n.z+7;town.add(g);g.position.set(x,elevation(x,z),z);g.rotation.y=j?-.8:.8;const local={g,x,z,baseX:x,baseZ:z,town:n.id,name:tr(j?'Садовник':'Путник',j?'Gardener':'Traveller'),text:tr(j?'Продукты растут за деревней. На рынке тебя ждёт ':'Дороги соединяют все поселения. Заказы принимает ',j?'Ingredients grow outside the village. The market customer is ':'The roads connect every settlement. Take orders from ')+n.name+'.'};locals.push(local)}
 }
 // Groves occur everywhere, but roads, resources, plazas and the initial parking
 // space are reserved. Tall vegetation is real scenery, not a resized resource.
 const treePoints=[];
 function tree(x,z,scale=1){if(Math.abs(x)>489||Math.abs(z)>489||Math.hypot(x,z-17)<11||roadDistance(x,z)<5.7||folks.some(n=>Math.hypot(x-n.x,z-n.z)<27)||nodes.some(n=>Math.hypot(x-n.x,z-n.z)<3.4)||solids.some(o=>Math.hypot(x-o.x,z-o.z)<o.r+1.4)||treePoints.some(p=>Math.hypot(p.x-x,p.z-z)<3.2))return;
  const b=biomeAt(x,z),y=elevation(x,z),h=(4.3+rnd()*3.1)*scale,r=.22+h*.025,wood=b==='frost'?0x8e9690:0x7b7560;
  instance(cylG,wood,x,y+h*.41,z,r,h*.82,r);if(b==='frost'){for(let j=0;j<3;j++)instance(coneG,j===2?0xc0d2c6:0x6d9588,x,y+h*(.48+j*.19),z,h*(.30-j*.055),h*.51,h*(.30-j*.055),0,rnd()*6,0)}
  else{const leaves=b==='canyon'?[0xa5a17a,0xc0aa7a,0x8b9a79]:b==='wetland'?[0x608f80,0x7aa18a,0x91ad87]:[0x6f946d,0x92ac7b,0x7fa382];for(let j=0;j<4;j++){const a=j*2.399,dx=Math.cos(a)*h*.19,dz=Math.sin(a)*h*.19;branch(x,y+h*.46,z,dx,h*.30,dz,r*.48,wood);instance(ballG,leaves[j%3],x+dx,y+h*(.80+(j%2)*.13),z+dz,h*.29,h*(b==='canyon'?.16:b==='wetland'?.36:.28),h*.26,0,a,0)}}
  solids.push({x,z,r:r+.08,h,kind:'tree'});treePoints.push({x,z});stats.trees++;
 }
 // Dense near-start groves ensure the richer world is visible immediately.
 for(let i=0;i<250;i++){const a=rnd()*Math.PI*2,r=24+rnd()*125;tree(Math.cos(a)*r,17+Math.sin(a)*r,.82+rnd()*.2)}
 for(let i=0;i<5500;i++){const x=rnd()*970-485,z=rnd()*970-485,patch=(Math.sin(x*.041)+Math.cos(z*.034)+Math.sin((x-z)*.018))/3;if(patch<-.12&&rnd()<.83)continue;tree(x,z)}
 // Flowering verges, shrubs and stone clusters between the larger groves.
 for(let i=0;i<3400;i++){const x=rnd()*970-485,z=rnd()*970-485;if(roadDistance(x,z)<3.3||folks.some(n=>Math.hypot(x-n.x,z-n.z)<19)||nodes.some(n=>Math.hypot(x-n.x,z-n.z)<1.8))continue;const y=elevation(x,z),b=biomeAt(x,z),c=b==='frost'?0xaac0ae:b==='canyon'?0xa5a375:0x7e9c74;if(i%3===0){for(let j=0;j<3;j++)instance(ballG,c,x+(j-1)*.3,y+.35,z,.5,.4,.5);stats.shrubs++}else{for(let j=0;j<3;j++){const px=x+(j-1)*.23,pz=z+Math.sin(j)*.2;instance(coneG,c,px,y+.22,pz,.08,.45,.08);instance(ballG,i%2?0xcbb7c4:0xe0d3a8,px,y+.46,pz,.12,.10,.12)}stats.flowers++}}
 // Roadside shelters, picnic tables and signposts break up longer journeys.
 for(const n of folks){const len=Math.hypot(n.x,n.z);if(len<100)continue;for(const f of [.36,.70]){const x=n.x*f-n.z/len*9,z=n.z*f+n.x/len*9;if(nodes.some(v=>Math.hypot(v.x-x,v.z-z)<5))continue;const g=new T.Group();g.position.set(x,elevation(x,z),z);root.add(g);props.push(g);for(const a of [-1,1])for(const b of [-1,1])cyl(g,a*2,1.45,b*1.4,.08,3,0x8b8164);box(g,0,3.05,0,4.8,.18,3.6,0x718b7a);box(g,0,.85,0,2.7,.18,1,0xb09b74);for(const a of [-1,1]){box(g,0,.45,a*.95,2.9,.15,.4,0xa28e69);box(g,a*.9,.4,0,.14,.9,1,0x7b8067)}cyl(g,-3,1.1,0,.065,2.3,0x8b8164);label(tr(...names[n.id]),g,-3,2.2,0,2.9);stats.camps++}}
 for(const {g,geo,c,list} of instances.values()){const m=new T.InstancedMesh(geo,material(c),list.length);for(let i=0;i<list.length;i++)m.setMatrixAt(i,list[i]);m.computeBoundingSphere();m.castShadow=true;m.receiveShadow=true;g.add(m)}
 function update(t,x,z){towns.forEach((g,i)=>g.visible=Math.hypot(folks[i].x-x,folks[i].z-z)<260);for(const g of chunks.values())g.visible=Math.hypot(g.userData.center.x-x,g.userData.center.y-z)<330;for(const g of props)g.visible=Math.hypot(g.position.x-x,g.position.z-z)<260;for(const l of locals){if(!l.g.parent.visible)continue;const near=Math.hypot(l.x-x,l.z-z)<4;l.g.rotation.y=T.MathUtils.damp(l.g.rotation.y,near?Math.atan2(x-l.x,z-l.z):Math.sin(t*.2+l.baseX)*.3,3,.016);l.g.userData.head.rotation.z=Math.sin(t*.8+l.baseX)*.025;l.g.userData.eyes.scale.y=(t+l.baseX)%5<.12?.15:1;}}
 return {root,towns,locals,props,roads,treePoints,stats,update,names};
}
