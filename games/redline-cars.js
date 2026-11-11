/* Authored vehicle geometry. Comrade1280 and vecarz, CC BY 4.0. See REDLINE-ASSET-LICENSES.md. */
function createRedlineCars(B,scene,environment,shadow){
 const catalog=[
 {id:0,name:'Vela H1',type:'HATCHBACK',drive:'FWD',hp:155,mass:1080,top:178,accel:7.3,grip:8.7,steer:.66,price:8500,L:3.83,W:1.70,H:1.48,wb:2.39,r:.31,cab:[-.38,-.29,.07,.30],nose:.80,spokes:5,color:'#d2ba7b'},
 {id:1,name:'Kestrel S2',type:'SPORT COUPÉ',drive:'RWD',hp:218,mass:1250,top:220,accel:8.8,grip:8.2,steer:.62,price:22000,L:4.35,W:1.78,H:1.26,wb:2.55,r:.33,cab:[-.28,-.15,.055,.25],nose:.68,spokes:6,color:'#bb654c'},
 {id:2,name:'Nord S4',type:'SPORT SEDAN',drive:'AWD',hp:285,mass:1580,top:241,accel:10.1,grip:10.4,steer:.56,price:39000,L:4.76,W:1.88,H:1.45,wb:2.82,r:.35,cab:[-.28,-.18,.13,.32],nose:.82,spokes:10,color:'#8dabb6'},
 {id:3,name:'Hawk V8',type:'MUSCLE',drive:'RWD',hp:390,mass:1740,top:258,accel:11.2,grip:6.7,steer:.49,price:53000,L:4.98,W:1.98,H:1.33,wb:2.87,r:.37,cab:[-.34,-.24,.035,.20],nose:.90,spokes:5,color:'#6f8184'},
 {id:4,name:'Ridge XR',type:'SPORT SUV',drive:'AWD',hp:325,mass:2180,top:214,accel:8.3,grip:7.2,steer:.51,price:45000,L:4.62,W:2.01,H:1.86,wb:2.74,r:.43,cab:[-.37,-.29,.12,.29],nose:1.02,spokes:6,color:'#9b9d7f'},
 {id:5,name:'Vector RS',type:'MID-ENGINE',drive:'RWD',hp:415,mass:1360,top:287,accel:13.1,grip:10.8,steer:.55,price:88000,L:4.39,W:1.96,H:1.16,wb:2.64,r:.35,cab:[-.20,-.13,.12,.30],nose:.58,spokes:7,color:'#c89b43'},
 {id:6,name:'Lynx Spyder',type:'ROADSTER',drive:'RWD',hp:265,mass:1140,top:248,accel:11.4,grip:9.7,steer:.70,price:65000,L:4.04,W:1.77,H:1.18,wb:2.35,r:.32,cab:[-.24,-.16,.095,.27],nose:.64,spokes:8,color:'#c7d0c9',open:true},
 {id:7,name:'Helix R',type:'RALLY AWD',drive:'AWD',hp:310,mass:1270,top:238,accel:12.0,grip:12.2,steer:.68,price:72000,L:3.98,W:1.87,H:1.45,wb:2.45,r:.35,cab:[-.38,-.27,.06,.29],nose:.83,spokes:12,color:'#537a9d'},
 {id:8,name:'Apex V12',type:'SUPERCAR',drive:'AWD',hp:585,mass:1490,top:326,accel:15.2,grip:10.1,steer:.49,price:155000,L:4.73,W:2.09,H:1.09,wb:2.77,r:.37,cab:[-.19,-.12,.15,.32],nose:.50,spokes:5,color:'#b84434'},
 {id:9,name:'Spectre GTR',type:'TRACK HOMOLOGATION',drive:'RWD',hp:510,mass:1315,top:312,accel:14.0,grip:12.5,steer:.60,price:180000,L:4.62,W:1.96,H:1.28,wb:2.72,r:.36,cab:[-.27,-.17,.11,.29],nose:.72,spokes:10,color:'#c4cdd0',hero:true}
 ];
 const library=window.__RL_MESHES;
 if(!library)throw Error('Встроенные модели автомобилей не распакованы.');
 const mapping=['compact','coupe','sedan','coupe','suv','sport','coupe','hatchback','sport','gtr'];
 const materialCache=new Map(),textureCache=new Map(),geometryCache=new Map(),baseMats=new Map();
 function material(c,metal=0,rough=.7){const key=c+':'+metal+':'+rough;if(!baseMats.has(key)){const m=new B.PBRMaterial(key,scene);m.albedoColor=B.Color3.FromHexString(c).toLinearSpace();m.metallic=metal;m.roughness=rough;m.reflectionTexture=environment;m.environmentIntensity=.85;baseMats.set(key,m)}return baseMats.get(key)}
 function texture(id){if(id==null)return null;if(!textureCache.has(id)){const t=new B.Texture(library.textures[id],scene,false,false);t.anisotropicFilteringLevel=4;textureCache.set(id,t)}return textureCache.get(id)}
 function importedMaterial(id,color,rims){const s=library.materials[id],key=id+':'+(s.paint?color:'')+':'+!!rims;if(materialCache.has(key))return materialCache.get(key);const m=new B.PBRMaterial('Imported / '+s.name,scene);m.albedoColor=s.paint?B.Color3.FromHexString(color).toLinearSpace():new B.Color3(...s.factor.slice(0,3));m.albedoTexture=texture(s.map);m.metallic=s.paint?.6:s.metal;m.roughness=s.paint?.72:Math.max(.15,s.rough);m.reflectionTexture=environment;m.environmentIntensity=.85;m.metallicTexture=texture(s.orm);m.useRoughnessFromMetallicTextureAlpha=false;m.useRoughnessFromMetallicTextureGreen=true;m.useMetallnessFromMetallicTextureBlue=true;m.backFaceCulling=false;
  if(s.paint){m.clearCoat.isEnabled=true;m.clearCoat.intensity=.85;m.clearCoat.roughness=.14}
  if(s.glass){m.albedoColor=B.Color3.FromHexString('#24343d').toLinearSpace();m.albedoTexture=null;m.metallic=.25;m.roughness=.13;m.alpha=1;m.clearCoat.isEnabled=true;m.clearCoat.intensity=1}
  if(rims&&/Wheel|Wheek/.test(s.name)){m.roughness*=.55;m.metallic=Math.max(.6,m.metallic)}materialCache.set(key,m);return m;
 }
 function batch(root,protect=[]){const groups=new Map();root.computeWorldMatrix(true);for(const m of root.getChildMeshes()){if(!m.material||!m.getTotalVertices())continue;let skip=false;for(let p=m;p&&p!==root;p=p.parent)if(protect.includes(p)){skip=true;break}if(skip)continue;m.computeWorldMatrix(true);const key=m.material.uniqueId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m)}for(const a of groups.values()){if(a.length<2)continue;a.forEach(m=>shadow?.removeShadowCaster(m));const m=B.Mesh.MergeMeshes(a,true,true,undefined,false,false);if(m){m.bakeTransformIntoVertices(root.getWorldMatrix().clone().invert());m.parent=root;m.position.setAll(0);m.rotation.setAll(0);m.isPickable=false;shadow?.addShadowCaster(m)}}}
 function decode(s,Type){const bytes=Uint8Array.from(atob(s),c=>c.charCodeAt(0));return new Type(bytes.buffer)}
 function sourcePart(p){if(!p.decoded)p.decoded={p:decode(p.p,Float32Array),n:decode(p.n,Float32Array),uv:decode(p.uv,Float32Array),ix:decode(p.ix,Uint32Array)};return p.decoded}
 function box(parent,x,y,z,w,h,d,mat){const m=B.MeshBuilder.CreateBox('Vehicle equipment',{width:w,height:h,depth:d},scene);m.parent=parent;m.position.set(x,y,z);m.material=mat;m.isPickable=false;shadow?.addShadowCaster(m);return m}
 function cutRoof(p,n,uv,ix,ceiling,screenRear,deckFront){const pp=[],nn=[],tt=[],ii=[];
 const clip=(poly,axis,value,less)=>{const out=[];for(let k=0;k<poly.length;k++){const a=poly[k],b=poly[(k+1)%poly.length],inside=less?a.p[axis]<=value:a.p[axis]>=value,next=less?b.p[axis]<=value:b.p[axis]>=value;if(inside)out.push(a);if(inside!==next){const t=(value-a.p[axis])/(b.p[axis]-a.p[axis]),v={};for(const key of ['p','n','uv'])v[key]=a[key].map((x,i)=>x+(b[key][i]-x)*t);out.push(v)}}return out};
 for(let j=0;j<ix.length;j+=3){const poly=[ix[j],ix[j+1],ix[j+2]].map(i=>({p:[p[i*3],p[i*3+1],p[i*3+2]],n:[n[i*3],n[i*3+1],n[i*3+2]],uv:[uv[i*2],uv[i*2+1]]}));for(const out of [clip(poly,2,screenRear,false),clip(poly,2,deckFront,true),clip(clip(clip(poly,2,screenRear,true),2,deckFront,false),1,ceiling,true)]){if(out.length<3)continue;const off=pp.length/3;for(const v of out){pp.push(...v.p);nn.push(...v.n);tt.push(...v.uv)}for(let k=1;k<out.length-1;k++)ii.push(off,off+k,off+k+1)}}return{p:new Float32Array(pp),n:new Float32Array(nn),uv:new Float32Array(tt),ix:new Uint32Array(ii)}}
 function make(id,options={}){
  const c=catalog[id]||catalog[0],key=options.asset||mapping[c.id],source=library.models[key],W=c.W,H=c.H,L=c.L,color=options.police?'#d7dedb':options.color||c.color;
  const root=new B.TransformNode(c.name+' / authored mesh',scene),body=new B.TransformNode('Suspended body',scene),hood=new B.TransformNode('Hinged bonnet',scene),wing=new B.TransformNode('Aerodynamics',scene);body.parent=root;hood.parent=body;wing.parent=body;hood.position.set(0,H*.58,L*.18);
  const wheels=[],front=[],lights=[],pivots=[],wheelCenters=source.wheels.map(w=>new B.Vector3(w.center[0]*W,w.center[1]*H,w.center[2]*L));
  for(const p of wheelCenters){const pivot=new B.TransformNode('Steering knuckle',scene);pivot.parent=root;pivot.position.copyFrom(p);const spin=new B.TransformNode('Wheel',scene);spin.parent=pivot;wheels.push(spin);pivots.push(pivot);if(p.z>0)front.push(pivot)}
  const rubber=material('#161b1e',0,.88),metal=material('#a8b5bb',.85,.24),trim=material('#20292c',.2,.55),paint=importedMaterial(source.parts.find(p=>library.materials[p.material].paint)?.material||0,color);
  const bodyTriangles=[];
  for(let k=0;k<source.parts.length;k++){
   const part=source.parts[k];let src=sourcePart(part),positions=new Float32Array(src.p.length),normals=new Float32Array(src.n.length);const indexBody=[],indexHood=[],dims=[W,H,L];
   for(let j=0;j<positions.length;j++){positions[j]=src.p[j]*dims[j%3];normals[j]=src.n[j]/dims[j%3]}
   for(let j=0;j<normals.length;j+=3){const n=Math.hypot(normals[j],normals[j+1],normals[j+2]);normals[j]/=n;normals[j+1]/=n;normals[j+2]/=n;}
   const isBody=library.materials[part.material].paint;
   if(c.id===6&&part.wheel<0&&isBody){const cut=cutRoof(positions,normals,src.uv,src.ix,H*.65,L*.022,-L*.37);positions=cut.p;normals=cut.n;src={...src,uv:cut.uv,ix:cut.ix}}
   for(let j=0;j<src.ix.length;j+=3){const a=src.ix[j],b=src.ix[j+1],d=src.ix[j+2],x=(positions[a*3]+positions[b*3]+positions[d*3])/3,y=(positions[a*3+1]+positions[b*3+1]+positions[d*3+1])/3,z=(positions[a*3+2]+positions[b*3+2]+positions[d*3+2])/3;

    if(c.id===6&&library.materials[part.material].glass&&(z<0||Math.abs(normals[a*3]+normals[b*3]+normals[d*3])>Math.abs(normals[a*3+2]+normals[b*3+2]+normals[d*3+2])))continue;
    const hoodFace=isBody&&part.wheel<0&&z>L*.20&&z<L*.47&&Math.abs(x)<W*.32&&y>H*.39&&y<H*.79&&(normals[a*3+1]+normals[b*3+1]+normals[d*3+1])>1.7;
    (hoodFace?indexHood:indexBody).push(a,b,d);
    if(isBody&&part.wheel<0)bodyTriangles.push([a,b,d].map(i=>[positions[i*3],positions[i*3+1],positions[i*3+2]]));
   }
   for(const [indices,isHood]of [[indexBody,false],[indexHood,true]]){if(!indices.length)continue;const cache=key+':'+c.id+':'+k+':'+isHood,center=isHood?hood.position:part.wheel>=0?wheelCenters[part.wheel]:B.Vector3.Zero();
    const mesh=new B.Mesh(isHood?'Imported hinged bonnet':'Imported '+library.materials[part.material].name,scene);mesh.parent=isHood?hood:part.wheel>=0?(part.fixed?pivots[part.wheel]:wheels[part.wheel]):body;
    if(!geometryCache.has(cache)||geometryCache.get(cache).getTotalVertices()===0){const p=new Float32Array(positions);for(let j=0;j<p.length;j+=3){p[j]-=center.x;p[j+1]-=center.y;p[j+2]-=center.z}const data=new B.VertexData();Object.assign(data,{positions:p,normals,uvs:src.uv,indices});geometryCache.set(cache,new B.Geometry(cache,scene,data,false));}
    geometryCache.get(cache).applyToMesh(mesh);mesh.material=importedMaterial(part.material,color,options.rims);mesh.isPickable=false;mesh.receiveShadows=true;if(!options.traffic)shadow?.addShadowCaster(mesh);
   }
  }
  // Closed cabin remains the author's shell; the Spyder is a true open-top derivative.
  if(c.id===6){
   box(body,0,H*.655,-L*.295,W*.73,H*.022,L*.15,material(color,.6,.5));
   for(const part of library.models.gtr.parts.filter(p=>library.materials[p.material].name==='seat'||/InteriorA/.test(library.materials[p.material].name))){const src=sourcePart(part),p=new Float32Array(src.p.length),n=new Float32Array(src.n);for(let j=0;j<p.length;j++)p[j]=src.p[j]*[W*.88,H*.92,L*.88][j%3];const mesh=new B.Mesh('Authored roadster cockpit',scene),d=new B.VertexData();Object.assign(d,{positions:p,normals:n,uvs:src.uv,indices:src.ix});d.applyToMesh(mesh);mesh.parent=body;mesh.material=importedMaterial(part.material,color);mesh.isPickable=false;}
   for(const side of [-1,1]){const hoop=B.MeshBuilder.CreateTorus('Roadster roll hoop',{diameter:.38,thickness:.025,tessellation:24},scene);hoop.parent=body;hoop.position.set(side*W*.21,H*.76,-L*.19);hoop.rotation.x=Math.PI/2;hoop.material=metal;hoop.isPickable=false;}
  }
  // The exposed mechanical bay belongs below the real split bonnet, not above the bodywork.
  if(c.id===9){box(body,0,H*.48,L*.30,W*.60,.045,L*.27,rubber);box(body,0,H*.54,L*.30,W*.29,.11,L*.13,trim);for(let i=-2;i<=2;i++)box(body,i*.075,H*.59,L*.30,.035,.022,.32,metal)}
  function surfaceY(x,z){let high=-Infinity;for(const [a,b,c]of bodyTriangles){const den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-7)continue;const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;if(u>=0&&v>=0&&u+v<=1)high=Math.max(high,u*a[1]+v*b[1]+(1-u-v)*c[1])}return Number.isFinite(high)?high:H*.55}
  if(c.id===3){const z=L*.32,y=surfaceY(0,z);const scoop=box(hood,0,y-hood.position.y+.035,z-hood.position.z,W*.30,.07,L*.14,material(color,.6,.5));box(hood,0,y-hood.position.y+.044,z-hood.position.z+L*.071,W*.24,.035,.012,rubber)}
  if(options.vinyl||c.id===3){for(const side of [-1,1]){const pa=[];for(let j=0;j<=22;j++){const z=L*(.205+j/22*.23);pa.push([-.025,.025].map(dx=>{const x=side*W*.15+dx;return new B.Vector3(x,surfaceY(x,z)+.007-hood.position.y,z-hood.position.z)}))}const stripe=B.MeshBuilder.CreateRibbon('Bonnet stripe',{pathArray:pa,sideOrientation:B.Mesh.DOUBLESIDE},scene);stripe.parent=hood;stripe.material=c.id===3?rubber:material('#d8dcce',.2,.35);stripe.isPickable=false}}
  if(options.wing||c.id===8){const z=-L*.39,y=surfaceY(0,z);for(const side of [-1,1])box(wing,side*W*.31,y+.13,z,.035,.26,.12,trim);box(wing,0,y+.27,z,W*.9,.045,.27,trim);for(const side of [-1,1])box(wing,side*W*.45,y+.29,z,.025,.12,.29,trim)}wing.setEnabled(!!options.wing||c.id===8);
  if(options.kit||c.id===8){for(const side of [-1,1])box(body,side*W*.43,.15,0,.065,.075,L*.50,trim);box(body,0,.12,L*.475,W*.74,.035,.17,trim)}
  if(options.police){box(body,0,H+.035,0,W*.62,.06,.22,trim);for(const side of [-1,1]){const m=material(side<0?'#274cbd':'#bc2525',.1,.3);m.emissiveColor=B.Color3.FromHexString(side<0?'#345aea':'#e83b35');lights.push(box(body,side*.3,H+.11,0,.4,.09,.20,m))}}
  const radius=wheelCenters.reduce((s,p)=>s+p.y,0)/4;
  return{root,body,hood,wing,wheels,front,lights,catalog:c,paint,imported:true,asset:key,dispose(){root.dispose()},animate(speed,steer,dt,lean=0){for(const w of wheels)w.rotation.x+=speed/Math.max(.2,radius)*dt;for(const p of front)p.rotation.y=steer;body.rotation.z=B.Scalar.Lerp(body.rotation.z,-lean*.004,.15);body.rotation.x=B.Scalar.Lerp(body.rotation.x,-Math.max(-.015,Math.min(.015,speed*.0002)),.12)}};
 }
 return{catalog,make,material,batch};
}
