/* Sky-Isle Logistics — procedural Babylon.js flight & delivery game. */
(async()=>{
'use strict';
const $=id=>document.getElementById(id),en=new URLSearchParams(location.search).get('lang')==='en',tr=(ru,eng)=>en?eng:ru;
document.documentElement.lang=en?'en':'ru';for(const el of document.querySelectorAll('[data-en]'))if(en)el.textContent=el.dataset.en;
let loadingMode='embedded';
async function unpack(data){const raw=Uint8Array.from(atob(data),c=>c.charCodeAt(0));if(!globalThis.DecompressionStream)throw Error(tr('Для автономного запуска нужен современный браузер с DecompressionStream.','Offline mode needs a modern browser with DecompressionStream.'));return await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}
async function library(key,url){let source=null;const offline=location.protocol==='file:'||!navigator.onLine||new URLSearchParams(location.search).has('offline');if(!offline){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),1800);try{const r=await fetch(url,{signal:abort.signal});if(!r.ok)throw Error('CDN '+r.status);source=await r.text();loadingMode='cdn'}catch{}finally{clearTimeout(timer)}}if(!source)source=await unpack(window.__SKY_LIBS[key]);return source}
function install(source){const el=document.createElement('script');el.textContent=source;document.head.appendChild(el);el.remove()}
try{
 $('loading').textContent=tr('Готовим остров и почтовый дрон…','Preparing the island and your postal drone…');
 const [core,gui]=await Promise.all([library('core','https://cdn.babylonjs.com/babylon.js'),library('gui','https://cdn.babylonjs.com/gui/babylon.gui.min.js')]);install(core);install(gui);delete window.__SKY_LIBS;
 if(!window.BABYLON?.GUI)throw Error('Babylon.js / Babylon GUI did not initialize');
 const B=window.BABYLON,canvas=$('flight');
 const fine=matchMedia('(hover: hover) and (pointer: fine)');function inputMode(){document.body.dataset.input=fine.matches||!navigator.maxTouchPoints?'desktop':'touch'}inputMode();fine.addEventListener('change',inputMode);window.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')document.body.dataset.input='touch';else if(e.pointerType==='mouse'&&fine.matches)document.body.dataset.input='desktop'},{capture:true});
 const engine=new B.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,antialias:true,powerPreference:'high-performance'},true);engine./* Буфер canvas в физических пикселях экрана (adaptToDeviceRatio=true), а
   рендер — не ниже 2× CSS-пикселя: на retina картинка резкая, но слабый GPU
   не рисует 3× (это вчетверо дороже, чем 1.5×). */
setHardwareScalingLevel(Math.max(1,(devicePixelRatio||1)/2));
 const scene=new B.Scene(engine);scene.clearColor=B.Color4.FromHexString('#b5d9e5ff');scene.fogMode=B.Scene.FOGMODE_LINEAR;scene.fogStart=450;scene.fogEnd=1900;scene.fogColor=B.Color3.FromHexString('#c7e2e9');scene.ambientColor=B.Color3.Black();
 const camera=new B.FreeCamera('Following camera',new B.Vector3(100,85,100),scene);camera.minZ=.12;camera.maxZ=3400;camera.fov=.82;camera.inputs.clear();scene.activeCamera=camera;
 const hemi=new B.HemisphericLight('Open sky',new B.Vector3(0,1,0),scene);hemi.intensity=.65;hemi.groundColor=B.Color3.FromHexString('#75896d');
 const sun=new B.DirectionalLight('Afternoon sunlight',new B.Vector3(.5,-1,.4),scene);sun.position.set(-55,85,-45);sun.intensity=.65;sun.diffuse=B.Color3.FromHexString('#fff0d2');
 const shadows=new B.ShadowGenerator(1024,sun);shadows.useBlurExponentialShadowMap=true;shadows.blurKernel=16;shadows.darkness=.16;shadows.bias=.001;sun.shadowMinZ=1;sun.shadowMaxZ=240;sun.shadowFrustumSize=170;
 const colors={grass:'#9fb482',edge:'#839d78',rock:'#918c7d',paleRock:'#b0a992',cream:'#f5ead1',blue:'#6293a7',dark:'#45696a',roof:'#b86f5c',gold:'#d7a14b',wood:'#b49a71',green:'#84b897',white:'#fbf6e6',leaf:'#7f9f78',cloud:'#f4f7ec'};
 const materials=new Map();function mat(color,alpha=1,glow=0){color=colors[color]||color;const key=[color,alpha,glow].join();if(!materials.has(key)){const m=new B.StandardMaterial('Mat '+key,scene);m.diffuseColor=B.Color3.FromHexString(color);m.specularColor=new B.Color3(.045,.045,.035);m.alpha=alpha;m.emissiveColor=m.diffuseColor.scale(glow);materials.set(key,m)}return materials.get(key)}
 function finish(m,x,y,z,color,parent=null,shadow=true){m.position.set(x,y,z);m.material=typeof color==='string'?mat(color):color;m.parent=parent;m.isPickable=false;m.receiveShadows=true;if(shadow)shadows.addShadowCaster(m);return m}
 function box(name,x,y,z,w,h,d,color,parent=null,shadow=true){return finish(B.MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene),x,y,z,color,parent,shadow)}
 function cyl(name,x,y,z,d,h,color,parent=null,opts={},shadow=true){return finish(B.MeshBuilder.CreateCylinder(name,{diameter:d,height:h,tessellation:20,...opts},scene),x,y,z,color,parent,shadow)}
 function sphere(name,x,y,z,sx,sy,sz,color,parent=null,shadow=true){const m=finish(B.MeshBuilder.CreateSphere(name,{diameter:2,segments:8},scene),x,y,z,color,parent,shadow);m.scaling.set(sx,sy,sz);return m}
 function torus(name,x,y,z,d,thick,color,parent=null,shadow=false){return finish(B.MeshBuilder.CreateTorus(name,{diameter:d,thickness:thick,tessellation:40},scene),x,y,z,color,parent,shadow)}
 const colliders=[],mills=[],clouds=[],rotors=[],sparks=[];
 let seed=49137;function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
 const arch=createSkyArchipelago({B,scene,mat,shadows,box,cyl,sphere,torus,colliders,tr});
 // Curved stepping-stone paths and flowers remain decorative, with no asset loads.
 function path(x,z,sx=0,sz=0){x-=sx;z-=sz;const length=Math.hypot(x,z),steps=Math.floor(length/2.2);for(let i=1;i<steps;i++){const f=i/steps,off=Math.sin(f*Math.PI)*1.4;const px=sx+x*f-z/length*off,pz=sz+z*f+x/length*off;const tile=box('Path paver',px,.045,pz,1.8,.09,1.5,i%3?'#d4c5a2':'#c7bc9e',null,false);tile.rotation.y=Math.atan2(x,z)}}
 function sign(text,parent,x,y,z,w=4,h=1){const tex=new B.DynamicTexture('Postal sign',{width:512,height:128},scene,false),ctx=tex.getContext();ctx.fillStyle='#f7edce';ctx.fillRect(0,0,512,128);ctx.strokeStyle='#68857a';ctx.lineWidth=5;ctx.strokeRect(8,8,496,112);ctx.font='600 38px Arial';ctx.fillStyle='#47665d';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,67,470);tex.update();const m=new B.StandardMaterial('Sign ink',scene);m.diffuseTexture=tex;m.specularColor=B.Color3.Black();m.backFaceCulling=false;const plane=B.MeshBuilder.CreatePlane('Nameplate',{width:w,height:h,sideOrientation:B.Mesh.DOUBLESIDE},scene);plane.position.set(x,y,z);plane.parent=parent;plane.material=m;plane.isPickable=false;plane.rotation.y=Math.PI;return plane}
 function house(x,z,index){const g=new B.TransformNode('House '+index,scene);g.position.set(x,0,z);g.rotation.y=Math.atan2(-x,-z);box('Stone doorstep',0,.16,0,6,.32,5.7,'#c1b99e',g);box('Plaster walls',0,2.05,0,5,3.8,4.7,index%2?'#eadfc1':'cream',g);const roof=cyl('Red pyramid roof',0,4.9,0,1,2.7,index%2?'#b98468':'roof',g,{diameterBottom:8,diameterTop:0,tessellation:4});roof.rotation.y=Math.PI/4;box('Chimney',1.5,5.1,-.8,.65,2.4,.65,'cream',g);box('Door',0,1.24,2.4,1.15,2.4,.1,'dark',g);sphere('Door knob',.4,1.24,2.49,.065,.065,.065,'gold',g);for(const s of [-1,1]){box('Window frame',s*1.54,2.25,2.43,1.08,1.25,.13,'dark',g);box('Warm glass',s*1.54,2.25,2.51,.9,1.03,.04,'#e8d49f',g);box('Window cross',s*1.54,2.25,2.55,.045,1.13,.05,'cream',g);box('Window cross',s*1.54,2.25,2.55,1,.045,.05,'cream',g);box('Flower box',s*1.54,1.53,2.58,1.3,.25,.45,'wood',g);for(let j=0;j<3;j++)sphere('Porch flowers',s*1.54+(j-1)*.35,1.79,2.59,.20,.19,.2,j%2?'#c99385':'leaf',g)}
  for(const side of [-1,1]){cyl('Rainwater downpipe',side*2.47,1.9,2.28,.075,3.7,'#8c9b91',g);box('Roof gutter',side*2.6,3.85,0,.12,.12,5.2,'#798a85',g);for(let k=0;k<6;k++){const seam=box('Standing roof seam',side*(.25+k*.38),5.65-k*.18,0,.025,.035,4.7,'#92654f',g);seam.rotation.z=-side*.48}}box('Chimney coping',1.5,6.33,-.8,.85,.15,.85,'#a6a28d',g);
  for(let j=0;j<3;j++)box('Entry steps',0,.05+j*.09,3.05-j*.21,1.8,.13+j*.12,.6,'#c4b69a',g);colliders.push({x,z,r:3.65,bottom:0,top:6.4,type:'building'});return g;
 }
 const destinations=[
 {name:tr('Дом Веры','Vera’s house'),x:-32,z:29,kind:'home',note:tr('Семена для сада','Seeds for the garden')},
 {name:tr('Дом Оливера','Oliver’s house'),x:10,z:41,kind:'home',note:tr('Книга о созвездиях','A book of constellations')},
 {name:tr('Дом Майи','Maya’s house'),x:39,z:16,kind:'home',note:tr('Чай с солнечных плантаций','Tea from the sun gardens')},
 {name:tr('Дом Феликса','Felix’s house'),x:-40,z:-3,kind:'home',note:tr('Новые акварельные краски','New watercolour paints')},
 {name:tr('Дом Лины','Lina’s house'),x:-9,z:-43,kind:'home',note:tr('Тёплый шарф','A warm scarf')},
 {name:tr('Обсерватория','Observatory'),x:28,z:-33,kind:'observatory',note:tr('Линза для телескопа','A telescope lens')},
 {name:tr('Солнечная мастерская','Solar workshop'),x:-34,z:-28,kind:'workshop',note:tr('Детали для солнечных батарей','Parts for solar panels')}
 ];
 destinations.forEach((d,i)=>Object.assign(d,{x:arch.sites[i].x,z:arch.sites[i].z}));
 for(let i=0;i<destinations.length;i++){const d=destinations[i],r=Math.hypot(d.x,d.z),inset=d.kind==='home'?7.6:9;d.id=i;d.pad={x:d.x-d.x/r*inset,z:d.z-d.z/r*inset};if(d.kind==='home')house(d.x,d.z,i);path(d.pad.x,d.pad.z,d.x,d.z);cyl('Receiving plaza',d.pad.x,.055,d.pad.z,6.7,.11,arch.paving,null,{tessellation:40},false);torus('Delivery circle inlay',d.pad.x,.12,d.pad.z,5.4,.065,'#e8e4c5');}
 // Central depot, solar-panel roof and parcels awaiting dispatch.
 const depot=new B.TransformNode('Postal Depot',scene);box('Depot foundation',0,.25,0,10,.5,8,'#c0b69a',depot);box('Blue postal hall',0,3,0,9,5.5,7,'blue',depot);box('Depot cornice',0,5.9,0,9.8,.4,7.6,'cream',depot);box('Roof garden lip',0,6.15,-.5,9,.12,6,'edge',depot);box('Postal entrance',0,1.65,3.57,2.1,3.2,.15,'dark',depot);for(const x of [-3,3]){box('Depot window',x,3.25,3.58,1.65,1.6,.15,'cream',depot);box('Depot glass',x,3.25,3.68,1.35,1.29,.08,'#93bec2',depot);box('Postal shutter',x,2.3,3.75,1.85,.17,.35,'cream',depot)}sign(tr('ПОЧТА · АЭРО-ВИЛЛЬ','AÉRO-VILLE · POST'),depot,0,4.7,3.78,5.8,1.1);box('Depot awning',0,3.8,4.6,4.7,.14,2.1,'cream',depot);for(const x of [-2.15,2.15])cyl('Awning post',x,1.8,5.2,.09,3.6,'dark',depot);
 for(let i=0;i<6;i++){const panel=box('Solar panel',(i%3-1)*2.5,6.5,-1+Math.floor(i/3)*2,2.1,.12,1.65,'#456b7e',depot);panel.rotation.x=-.18;for(let k=0;k<3;k++)box('Panel cells',(i%3-1)*2.5+(k-1)*.6,6.6,-1+Math.floor(i/3)*2,.025,.015,1.5,'#9bbdc1',depot,false)}
 for(let i=0;i<4;i++){box('Waiting parcel',-3.4+(i%2)*.8,.42+Math.floor(i/2)*.7,5,.65,.65,.6,'wood',depot);box('Packing tape',-3.4+(i%2)*.8,.75+Math.floor(i/2)*.7,5,.15,.018,.62,'cream',depot)}colliders.push({x:0,z:0,r:5.8,bottom:0,top:6.9,type:'building'});
 const depotPad={x:0,z:11};cyl('Green pickup apron',0,.07,11,7.8,.14,'#bdd3ab',null,{tessellation:48},false);const greenDisk=cyl('Green depot marker',0,.17,11,6.5,.035,mat('#72b886',.38,.3),null,{tessellation:48},false);const depotRing=torus('Pickup ring',0,.22,11,6.55,.12,mat('#b6e4a6',1,.35));
 // Observatory: rounded copper dome and a brass telescope.
 const obs=new B.TransformNode('Observatory',scene);obs.position.set(destinations[5].x,0,destinations[5].z);cyl('Round observatory',0,2.1,0,8.3,4.2,'cream',obs);sphere('Copper dome',0,4.2,0,4.4,3.1,4.4,'#78a6a3',obs);const scope=cyl('Brass telescope',1,6,-.5,.95,5.5,'gold',obs);scope.rotation.x=.92;torus('Observatory trim',0,4,0,8.6,.14,'gold',obs);for(let i=0;i<8;i++){const a=i*Math.PI/4;box('Observatory columns',Math.sin(a)*3.8,2,Math.cos(a)*3.8,.26,4,.26,'#c8c4a8',obs)}colliders.push({x:destinations[5].x,z:destinations[5].z,r:4.5,bottom:0,top:8.5,type:'building'});
 const shop=new B.TransformNode('Solar workshop',scene);shop.position.set(destinations[6].x,0,destinations[6].z);shop.rotation.y=.7;box('Workshop',0,2.2,0,7,4.4,5.2,'#c1b395',shop);box('Workshop roof',0,4.6,0,7.7,.35,5.8,'dark',shop);for(const x of [-2,0,2]){const panel=box('Workshop solar array',x,5,0,1.7,.12,4.5,'#557f8c',shop);panel.rotation.x=-.2}box('Workshop doorway',0,1.6,2.65,2,3.1,.12,'#637e70',shop);sign(tr('МАСТЕРСКАЯ','WORKSHOP'),shop,0,3.6,2.8,5.4,.75);for(const x of [-2.55,2.55])box('Workshop windows',x,2.6,2.7,1.3,1.2,.1,'#ead69d',shop);colliders.push({x:destinations[6].x,z:destinations[6].z,r:4.4,bottom:0,top:5.5,type:'building'});
 function windmill(x,z,height){const g=new B.TransformNode('Windmill tower',scene);g.position.set(x,0,z);cyl('White tapered tower',0,height/2,0,1,height,'cream',g,{diameterBottom:3.1,diameterTop:1.8,tessellation:20});torus('Tower collar',0,height-.3,0,2,.12,'dark',g);const rotor=new B.TransformNode('Slow windmill rotor',scene);rotor.parent=g;rotor.position.set(0,height-.4,1.45);const hub=cyl('Rotor hub',0,0,0,.7,.6,'gold',rotor);hub.rotation.x=Math.PI/2;for(let i=0;i<4;i++){const blade=new B.TransformNode('Blade arm',scene);blade.parent=rotor;blade.rotation.z=i*Math.PI/2;box('Blade spar',0,2.7,0,.13,4.9,.12,'dark',blade);box('Cream sail',.31,3.05,.04,.75,3.2,.13,'white',blade);for(let j=0;j<4;j++)box('Sail rib',.31,1.7+j*.8,.13,.75,.045,.025,'#c8ccb6',blade)}mills.push({x,z,height:height-.4,rotor,angle:.2+x*.1});colliders.push({x,z,r:1.6,bottom:0,top:height+.4,type:'mill'});box('Maintenance door',0,1.2,1.49,.8,2.1,.1,'dark',g)}
 windmill(-18,17,10);windmill(19,13,11);windmill(-8,-23,9.6);
 for(let i=0;i<arch.sites.length;i++){const d=destinations[i];windmill(d.x+24,d.z-17,10+(i%3));for(const side of [-1,1]){cyl('Landing guidance lamp',d.pad.x+side*4,.8,d.pad.z,.11,1.6,'dark');sphere('Warm approach light',d.pad.x+side*4,1.63,d.pad.z,.16,.12,.16,mat('#e4cf9e',1,.35),null,false)}box('Parcel locker',d.x-8,.8,d.z+5,1.3,1.6,.85,'#7e9691');for(let j=0;j<3;j++)box('Locker door',d.x-8,.4+j*.43,d.z+5.45,1.1,.37,.04,'#a7b2a1')}
 // Pocket gardens, benches and leafy trees fill the island without blocking pads.
 function clearSpot(x,z,r){return Math.hypot(x,z)<53&&Math.hypot(x,z-11)>8&&!colliders.some(c=>Math.hypot(x-c.x,z-c.z)<c.r+r+2)&&!destinations.some(d=>Math.hypot(x-d.pad.x,z-d.pad.z)<6)}
 let trees=0;for(let i=0;i<260&&trees<40;i++){const a=rnd()*Math.PI*2,r=17+rnd()*35,x=Math.sin(a)*r,z=Math.cos(a)*r;if(!clearSpot(x,z,1.8))continue;const h=2.6+rnd()*1.9;cyl('Tree trunk',x,h*.43,z,.30,h*.86,'wood',null,{tessellation:7});sphere('Rounded foliage',x,h,z,1.6,1.7,1.5,trees%3?'leaf':'#a9bb81');sphere('Side foliage',x+.7,h-.25,z-.4,1.05,1.1,1.2,'#95ae7c');colliders.push({x,z,r:.32,bottom:0,top:h+1.6,type:'tree'});trees++}
 for(let i=0;i<210;i++){const a=rnd()*Math.PI*2,r=9+rnd()*44,x=Math.sin(a)*r,z=Math.cos(a)*r;if(!clearSpot(x,z,.2))continue;cyl('Flower stem',x,.23,z,.025,.46,'edge',null,{tessellation:4},false);sphere('Wild flower',x,.5,z,.15,.13,.15,i%3?'#e4cb9f':'#c59691',null,false)}
 for(let i=0;i<7;i++){const d=destinations[i],x=d.pad.x+3.8,z=d.pad.z+2.5;box('Garden bench',x,.6,z,2.4,.14,.65,'wood');box('Bench back',x,1,z+.26,2.4,.8,.1,'wood');for(const side of [-1,1])box('Bench leg',x+side*.8,.3,z,.12,.6,.58,'dark')}
 // Quiet cloud banks below the floating cliffs and along the horizon.
 for(let i=0;i<48;i++){const g=new B.TransformNode('Cloud bank',scene),a=i/48*Math.PI*2,r=80+rnd()*1450;g.position.set(Math.sin(a)*r,-36+rnd()*25,Math.cos(a)*r);for(let j=0;j<4;j++)sphere('Cloud puff',(j-1.5)*18,Math.sin(j)*1.2,0,17+rnd()*9,4.6+rnd()*3.5,14+rnd()*7,mat('cloud',.93,.2),g,false);clouds.push({g,x:g.position.x,z:g.position.z,phase:rnd()*6})}
 // Courier quadcopter. The parcel hangs between landing skids, not through them.
 const drone=new B.TransformNode('Courier drone',scene),body=new B.TransformNode('Leaning airframe',scene);body.parent=drone;
 box('Orange postal airframe',0,0,0,1.6,.43,1.45,'gold',body);box('Ivory top shell',0,.25,-.10,1.26,.17,1.04,'cream',body);box('Navigation glass',0,.13,.7,.95,.27,.06,'dark',body);box('Postal stripe',0,.35,-.07,.22,.025,1.04,'blue',body,false);
 for(const x of [-1.15,1.15])for(const z of [-1.15,1.15]){const arm=box('Motor arm',x*.53,-.02,z*.53,.17,.15,Math.hypot(x,z),'dark',body);arm.rotation.y=Math.atan2(x,z);cyl('Gold motor',x,.08,z,.31,.32,'gold',body);torus('Propeller guard',x,.29,z,1.34,.042,'dark',body);const rotor=new B.TransformNode('Spinning propeller',scene);rotor.parent=body;rotor.position.set(x,.32,z);cyl('Rotor disc',0,0,0,1.18,.016,mat('#557771',.16),rotor,{tessellation:24},false);box('Propeller blade',0,.025,0,1.16,.03,.105,'dark',rotor,false);box('Propeller blade',0,.026,0,.105,.03,1.16,'dark',rotor,false);rotors.push(rotor)}
 for(const x of [-.77,.77]){box('Landing skid',x,-.69,0,.12,.1,1.65,'dark',body);for(const z of [-.5,.5])box('Skid support',x,-.42,z,.07,.48,.07,'dark',body)}
 for(const x of [-.53,.53])sphere('Flight lamp',x,.07,.75,.07,.065,.045,mat('#fff6cb',1,.6),body,false);
 function parcel(parent){const g=new B.TransformNode('Postal parcel',scene);g.parent=parent;box('Cardboard parcel',0,0,0,.78,.62,.72,'#b99061',g);box('Tape across top',0,.315,0,.13,.025,.73,'cream',g);box('Tape around parcel',0,0,.365,.13,.63,.018,'cream',g);box('Shipping label',.19,.326,.08,.22,.015,.31,'#f5eccb',g);return g}
 arch.detailsDrone(body);
 const cargo=parcel(body);cargo.position.y=-.66;cargo.setEnabled(false);
 const deliveryRing=torus('Active delivery halo',0,.18,0,5.7,.16,mat('#efbc70',1,.35));const innerRing=torus('Active delivery inner halo',0,.19,0,4.9,.045,mat('#fff0c2',1,.45));const dropDisk=cyl('Receiving glow',0,.13,0,5.9,.025,mat('#edc782',.28,.2),null,{tessellation:48},false);
 const beacon=B.MeshBuilder.CreateBox('Marker anchor',{size:.05},scene);beacon.visibility=0;beacon.isPickable=false;
 // Babylon GUI is used for the world-linked mission marker, independent of DOM UI.
 const guiTexture=B.GUI.AdvancedDynamicTexture.CreateFullscreenUI('Delivery marker UI',true,scene);guiTexture.idealWidth=0;const marker=new B.GUI.Rectangle('Active address label');marker.width='210px';marker.height='45px';marker.cornerRadius=12;marker.color='#fff8df';marker.thickness=1;marker.background='#426c65dd';marker.isPointerBlocker=false;guiTexture.addControl(marker);marker.linkWithMesh(beacon);marker.linkOffsetY=-43;const markerText=new B.GUI.TextBlock('Address','');markerText.color='#fff8e7';markerText.fontFamily='Arial';markerText.fontSize=13;markerText.textWrapping=true;marker.addControl(markerText);
 // Material batches keep the island inexpensive on mobile GPUs.
 const movingRoots=new Set([drone,...mills.map(m=>m.rotor),...clouds.map(c=>c.g),deliveryRing,innerRing,depotRing,greenDisk,dropDisk,beacon]);
 const staticGroups=new Map();for(const m of [...scene.meshes]){let moving=false;for(let p=m;p;p=p.parent)if(movingRoots.has(p)){moving=true;break}if(moving||!m.material||m.getTotalVertices()===0)continue;m.computeWorldMatrix(true);const world=m.getAbsolutePosition();const key=m.material.uniqueId+':'+Math.floor(world.x/180)+':'+Math.floor(world.z/180);if(!staticGroups.has(key))staticGroups.set(key,[]);staticGroups.get(key).push(m)}
 for(const list of staticGroups.values()){if(list.length<2)continue;const casts=list.some(m=>shadows.getShadowMap().renderList.includes(m));for(const m of list)shadows.removeShadowCaster(m);const merged=B.Mesh.MergeMeshes(list,true,true,undefined,false,false);if(merged){merged.isPickable=false;merged.receiveShadows=true;if(casts)shadows.addShadowCaster(merged);merged.freezeWorldMatrix()}}
 let storageKey='vg_sky_isle_v1:solo',storageOK=true,accountName=null;try{if(parent!==window&&typeof parent.getCurrentUser==='function'){accountName=parent.getCurrentUser();if(accountName)storageKey='vg_sky_isle_v1:'+accountName}}catch{}
 let saved=null;try{saved=JSON.parse(localStorage.getItem(storageKey))}catch{storageOK=false}
 const S={score:0,earned:0,pending:[],legLength:11,order:null,next:0,position:new B.Vector3(0,4,22),velocity:B.Vector3.Zero(),heading:Math.PI};
 if([1,2].includes(saved?.version)){S.score=Math.max(0,Math.min(999999,Math.floor(Number(saved.score)||0)));S.next=Math.max(0,Math.min(999999,Math.floor(Number(saved.next)||0)));S.order=Number.isInteger(saved.order)&&destinations[saved.order]?saved.order:null;if(Array.isArray(saved.position)&&saved.position.length===3&&saved.position.every(Number.isFinite)){S.position.set(saved.position[0],Math.max(1.5,Math.min(20,saved.position[1])),saved.position[2]);const r=Math.hypot(S.position.x,S.position.z);if(r>arch.worldRadius){S.position.x*=arch.worldRadius/r;S.position.z*=arch.worldRadius/r}}}
 if(saved?.version===2){S.earned=Math.max(0,Math.min(9999999,Number(saved.earned)||0));S.pending=Array.isArray(saved.pending)?saved.pending.filter(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id)):[];S.legLength=Math.max(1,Math.min(4000,Number(saved.legLength)||11))}
 if(saved?.version===3&&saved.ext&&typeof saved.ext==='object')S.ext=saved.ext;else if(saved?.version===2)S.ext=Object.assign({},S.ext,{fuel:0,res:saved.res||undefined});
 if(saved?.version!==2){const p=S.order===null?depotPad:destinations[S.order].pad;S.legLength=Math.max(1,Math.hypot(S.position.x-p.x,S.position.z-p.z))}
 function save(){try{localStorage.setItem(storageKey,JSON.stringify({version:3,score:S.score,earned:S.earned,pending:S.pending,legLength:S.legLength,order:S.order,next:S.next,position:S.position.asArray(),ext:S.ext}))}catch{storageOK=false}}
/* ===========================================================================
   Логистика Скай-Айла: топливо, ресурсы, контракты, пассажиры и станции.
   ---------------------------------------------------------------------------
   Модуль намеренно вынесен в отдельную фабрику: он получает наружу только то,
   что нужно (сцену, материалы, список островов, состояние S), не переписывает
   полёт и доставку посылок и легко проверяется тестом без WebGL.
   Валюта остаётся прежней: 5 V за доставку посылки, как в каталоге. Ресурсы
   (дерево, камень, металл) — не валюта, а материалы для улучшения станций.
   ========================================================================== */
function skyLogistics(ctx) {
  const B = ctx.B, scene = ctx.scene, box = ctx.box, cyl = ctx.cyl, sphere = ctx.sphere;
  const mat = ctx.mat, destinations = ctx.destinations, depotPad = ctx.depotPad;
  const S = ctx.S, message = ctx.message, tr = ctx.tr, $ = ctx.$;
  const RES = ['wood', 'stone', 'metal'];
  const LIMIT = 9999;

  if (!S.ext || typeof S.ext !== 'object') S.ext = {};
  const X = S.ext;
  X.fuel = Math.max(0, Math.min(400, Number(X.fuel)));
  if (!isFinite(X.fuel) || X.fuel <= 0) X.fuel = 100;
  X.res = Object.assign({ wood: 0, stone: 0, metal: 0 }, X.res);
  X.up = Object.assign({ station: 1, storage: 1, platform: 1, workshop: 1 }, X.up);
  X.missions = Array.isArray(X.missions) ? X.missions.slice(0, 3) : [];
  X.passenger = X.passenger && typeof X.passenger === 'object' ? X.passenger : null;
  X.stats = Object.assign({ deliveries: 0, collected: 0, passengers: 0, contracts: 0 }, X.stats);
  X.seed = Number(X.seed) || 7;

  const fuelCap = () => 100 + 25 * (X.up.station - 1);
  const resCap = () => 40 + 20 * (X.up.storage - 1);
  const collectRadius = () => 3.1 + 0.7 * (X.up.workshop - 1);
  const boardRadius = () => 3.4 + 0.5 * (X.up.platform - 1);
  X.fuel = Math.min(X.fuel, fuelCap());

  const resName = { wood: tr('дерево', 'wood'), stone: tr('камень', 'stone'), metal: tr('металл', 'metal') };
  const resColor = { wood: '#b08a54', stone: '#9aa0a2', metal: '#8fb6cf' };

  /* --------------------------------------------------------- ресурсные узлы */
  const nodes = [];
  const nodeGroup = new B.TransformNode('Resource nodes', scene);
  function makeNode(i, slot, type) {
    const d = destinations[i];
    const a = (slot / 3) * Math.PI * 2 + i * 0.7;
    const r = 8.5 + slot * 1.5;
    const x = d.pad.x + Math.sin(a) * r, z = d.pad.z + Math.cos(a) * r;
    const g = new B.TransformNode('Node ' + type, scene);
    g.parent = nodeGroup;
    g.position.set(x, 0, z);
    if (type === 'wood') {
      box('Log pile', 0, .28, 0, 1.5, .56, .62, 'wood', g);
      box('Log pile', 0, .86, .1, 1.2, .5, .55, '#9c7a4b', g);
      cyl('Stump', .9, .3, -.3, .55, .6, '#8a6a44', g, { tessellation: 8 });
    } else if (type === 'stone') {
      sphere('Boulder', 0, .45, 0, .9, .6, .8, '#9b9f9d', g);
      sphere('Boulder', .8, .3, .4, .5, .38, .5, '#8b8f8d', g);
    } else if (type === 'metal') {
      const c = box('Ore crystal', 0, .55, 0, .55, 1.1, .55, '#9fc4d8', g);
      c.rotation.z = .2;
      box('Ore crystal', .42, .35, .18, .38, .8, .38, '#7fa8c0', g).rotation.z = -.3;
      box('Ore base', 0, .08, 0, 1.1, .16, 1.1, '#6f7a7d', g);
    } else {
      cyl('Fuel canister', 0, .42, 0, .85, .84, '#d7a14b', g);
      cyl('Fuel band', 0, .56, 0, .9, .12, '#8c6a2f', g);
      box('Fuel handle', 0, .92, 0, .3, .18, .12, '#7c5d2a', g);
    }
    const meshes = g.getChildMeshes ? g.getChildMeshes() : [];
    nodes.push({ i, slot, type, x, z, g, meshes, readyAt: 0, bob: Math.random() * 6 });
    return g;
  }
  destinations.forEach(function (d, i) {
    for (let s = 0; s < 3; s++) makeNode(i, s, RES[(i + s) % 3]);
    makeNode(i, 3, 'fuel');
  });

  function nodeVisible(n, on) {
    n.meshes.forEach(function (m) { m.setEnabled(on); });
  }

  /* --------------------------------------------------------------- станции */
  const stations = destinations.map(function (d, i) {
    const g = new B.TransformNode('Fuel station ' + i, scene);
    g.position.set(d.pad.x + 5.2, 0, d.pad.z - 4.2);
    cyl('Fuel stand', 0, .9, 0, 1.1, 1.8, '#e6dcc3', g);
    cyl('Fuel tank', 0, 2.05, 0, 1.25, .8, '#d7a14b', g);
    box('Fuel hose', .7, 1.05, 0, .12, 1.4, .12, '#5a5140', g);
    const ring = ctx.torus ? ctx.torus('Fuel pad ring', d.pad.x + 5.2, .06, d.pad.z - 4.2, 3.4, .09, '#e7d7a8', null, false) : null;
    return { x: d.pad.x + 5.2, z: d.pad.z - 4.2, g, ring };
  });

  /* ------------------------------------------------- оформление архипелага */
  /* У каждого острова свой характер: лесной, фермерский, индустриальный или
     горный. Это не декоративная случайность — по силуэту видно, что везти. */
  const BIOMES = ['forest', 'farm', 'industry', 'mountain'];
  const biomeName = {
    forest: tr('лесной', 'forest'), farm: tr('фермерский', 'farm'),
    industry: tr('индустриальный', 'industry'), mountain: tr('горный', 'mountain')
  };
  function decorate() {
    destinations.forEach(function (d, i) {
      const kind = BIOMES[i % BIOMES.length];
      d.biome = kind;
      const px = d.pad.x, pz = d.pad.z;
      const r = 9.4;
      if (kind === 'forest') {
        for (let k = 0; k < 4; k++) {
          const a = k * 1.7 + i, x = px + Math.sin(a) * (r + k * 0.7), z = pz + Math.cos(a) * (r + k * 0.6);
          cyl('Forest pine trunk', x, 1.5, z, .34, 3, 'wood', null, { tessellation: 7 });
          sphere('Forest pine crown', x, 3.4, z, 1.3, 1.7, 1.2, 'leaf', null);
        }
        box('Timber stack', px - 5.5, .5, pz + 5, 2.2, .9, 1, 'wood');
      } else if (kind === 'farm') {
        for (let k = 0; k < 3; k++) {
          const x = px - 6 + k * 2.4, z = pz + 6.4;
          box('Crop row', x, .12, z, 1.9, .18, 3.4, '#7f9f6a');
          for (let c = 0; c < 3; c++) cyl('Crop', x - .6 + c * .6, .3, z, .22, .34, '#9dbb72', null, { tessellation: 6 }, false);
        }
        cyl('Hay bale', px + 6.6, .6, pz + 4.4, 1.3, 1.1, '#d8c68a', null, { tessellation: 12 });
        box('Barn', px + 7.4, 1.6, pz - 4.6, 3.4, 3.2, 2.8, '#b98a63');
      } else if (kind === 'industry') {
        cyl('Storage tank', px + 6.8, 1.7, pz + 5, 2.6, 3.4, '#c8ccd0');
        cyl('Storage tank cap', px + 6.8, 3.5, pz + 5, 2.7, .3, '#9aa0a2');
        box('Cargo container', px - 7.2, 1, pz + 5.2, 3.6, 1.9, 1.7, '#a8705a');
        box('Cargo container', px - 7.2, 3, pz + 5.2, 3.6, 1.9, 1.7, '#6f8f9c');
        cyl('Factory chimney', px - 8, 3.4, pz - 3, 1.1, 6.8, '#b9b2a0', null, { tessellation: 10 });
      } else {
        for (let k = 0; k < 5; k++) {
          const a = k * 1.3 + i * .7, x = px + Math.sin(a) * (r - 1), z = pz + Math.cos(a) * (r - 1);
          sphere('Mountain boulder', x, .6, z, 1.4, .9, 1.2, '#9b9d99');
        }
        box('Stone shelter', px + 6, 1.2, pz - 5, 2.6, 2.4, 2.4, '#a9a49a');
        cyl('Shelter roof', px + 6, 2.7, pz - 5, 1, 1.1, '#8f8b80', null, { diameterBottom: 3.8, diameterTop: 0, tessellation: 4 });
      }
      // Табличка с характером острова у площадки.
      if (ctx.sign) ctx.sign(biomeName[kind].toUpperCase(), null, px + 3.6, 1.9, pz - 3.2, 3.2, .8);
    });

    /* Грузовой терминал у депо: контейнеры, кран и причал дирижабля — точка
       отсчёта всей сети, куда игрок возвращается за топливом. */
    for (let k = 0; k < 4; k++) {
      box('Terminal container', -13 + k * 2.9, .95, 13.6, 2.6, 1.9, 2.2, k % 2 ? '#8fb0b8' : '#c58d6b');
    }
    box('Terminal rail', -12, 2.2, 13.6, 12.4, .22, .3, '#7c8480');
    cyl('Crane mast', 13.4, 3.2, 11.6, .7, 6.4, '#7f8f93', null, { tessellation: 8 });
    box('Crane arm', 12.2, 6.2, 11.6, 4.4, .28, .34, '#7f8f93');
    box('Crane hook', 10.4, 5.4, 11.6, .18, 1.5, .18, '#5f6a6c');
    cyl('Airship mast', -9.6, 4.6, 6.4, .5, 9.2, '#d9d2bd', null, { tessellation: 8 });
    sphere('Airship hull', -9.6, 10.2, 6.4, 3.2, 1.5, 1.5, '#efe6cf');
    box('Airship gondola', -9.6, 8.9, 6.4, 2.4, .7, 1, '#b98a63');
  }
  decorate();

  /* -------------------------------------------------------------- контракты */
  let missionSeq = 1;
  function rnd() { X.seed = (Math.imul(X.seed, 1664525) + 1013904223) >>> 0; return X.seed / 4294967296; }
  function pick(list) { return list[Math.floor(rnd() * list.length) % list.length]; }
  function reward() {
    const r = { wood: 0, stone: 0, metal: 0 };
    const main = pick(RES);
    r[main] = 3 + Math.floor(rnd() * 3);
    r[pick(RES)] += 2;
    return r;
  }
  function makeMission(kind) {
    const m = { id: 'm' + (missionSeq++) + '-' + Math.floor(rnd() * 9999), kind: kind, have: 0, need: 1, reward: reward(), done: false };
    if (kind === 'deliver') {
      m.need = 2 + Math.floor(rnd() * 2);
      m.title = tr('Доставить посылки', 'Deliver parcels');
    } else if (kind === 'collect') {
      const t = pick(RES);
      m.res = t;
      m.need = 4 + Math.floor(rnd() * 4);
      m.title = tr('Собрать ', 'Collect ') + resName[t];
    } else if (kind === 'passenger') {
      const from = Math.floor(rnd() * destinations.length);
      let to = Math.floor(rnd() * destinations.length);
      if (to === from) to = (to + 1) % destinations.length;
      m.from = from; m.to = to; m.need = 1;
      m.title = tr('Пассажир: ', 'Passenger: ') + destinations[from].name + ' → ' + destinations[to].name;
      X.passenger = { from: from, to: to, taken: false, mission: m.id };
    } else {
      m.need = 3;
      m.title = tr('Срочный контракт', 'Urgent contract');
      m.contract = true;
    }
    return m;
  }
  function ensureMissions() {
    let guard = 0;
    while (X.missions.length < 3 && guard++ < 8) {
      const kind = X.missions.length === 0 ? 'deliver'
        : (rnd() < 0.18 && !X.missions.some(function (m) { return m.contract; }) ? 'contract' : pick(['deliver', 'collect', 'passenger']));
      if (kind === 'passenger' && X.passenger) continue;
      X.missions.push(makeMission(kind));
    }
  }
  ensureMissions();

  /* ------------------------------------------------------------- улучшения */
  const UPG = {
    station: { name: tr('Топливная станция', 'Fuel station'), note: tr('+25 к запасу топлива', '+25 fuel capacity'), cost: { stone: 6, metal: 3 } },
    storage: { name: tr('Склад', 'Storage'), note: tr('+20 к лимиту ресурсов', '+20 resource capacity'), cost: { wood: 8, stone: 4 } },
    platform: { name: tr('Посадочная площадка', 'Landing platform'), note: tr('Шире зона посадки и пассажиров', 'Wider landing and boarding area'), cost: { wood: 6, stone: 6 } },
    workshop: { name: tr('Мастерская', 'Workshop'), note: tr('Сбор ресурсов с большего расстояния', 'Collect resources from farther away'), cost: { wood: 5, metal: 4 } }
  };
  const MAX_UP = 3;
  function upCost(key) {
    const c = UPG[key].cost, lvl = X.up[key];
    const out = {};
    Object.keys(c).forEach(function (k) { out[k] = Math.round(c[k] * Math.pow(1.6, lvl - 1)); });
    return out;
  }
  function canPay(cost) { return Object.keys(cost).every(function (k) { return (X.res[k] || 0) >= cost[k]; }); }
  function pay(cost) { Object.keys(cost).forEach(function (k) { X.res[k] -= cost[k]; }); }
  function upgrade(key) {
    if (!UPG[key] || X.up[key] >= MAX_UP) return false;
    const cost = upCost(key);
    if (!canPay(cost)) { message(tr('Не хватает материалов: нужно ', 'Not enough materials, need ') + costText(cost)); return false; }
    pay(cost);
    X.up[key]++;
    if (key === 'station') X.fuel = fuelCap();
    message(UPG[key].name + ' · ' + tr('уровень ', 'level ') + X.up[key]);
    dirty = true;
    paint(true);
    return true;
  }
  function costText(cost) {
    return Object.keys(cost).map(function (k) { return cost[k] + ' ' + resName[k]; }).join(', ');
  }

  /* -------------------------------------------------------------- прогресс */
  let dirty = true, towArmed = 0, emptyWarned = 0, collectCd = 0, lastFuel = X.fuel;
  function addRes(type, n) {
    const room = Math.max(0, resCap() - (X.res[type] || 0));
    const got = Math.min(room, n);
    X.res[type] = Math.min(LIMIT, (X.res[type] || 0) + got);
    return got;
  }
  function completeMission(m) {
    if (m.done) return;
    m.done = true;
    const parts = [];
    Object.keys(m.reward).forEach(function (k) {
      const got = addRes(k, m.reward[k]);
      if (got) parts.push('+' + got + ' ' + resName[k]);
    });
    X.stats.deliveries += m.kind === 'deliver' ? 1 : 0;
    message(tr('Миссия выполнена: ', 'Mission complete: ') + m.title + (parts.length ? ' · ' + parts.join(', ') : ''));
    X.missions = X.missions.filter(function (x) { return x.id !== m.id; });
    ensureMissions();
    dirty = true;
  }
  function progress(kind, match) {
    X.missions.forEach(function (m) {
      if (m.kind !== kind) return;
      if (match && !match(m)) return;
      m.have = Math.min(m.need, m.have + 1);
      if (m.have >= m.need) completeMission(m);
    });
  }
  function onPickup() { dirty = true; }
  function onDeliver() {
    X.stats.deliveries++;
    progress('deliver');
    progress('contract', null);
    dirty = true;
  }
  function onCollect(type, n) {
    const got = addRes(type, n);
    X.stats.collected += got;
    if (got > 0) progress('collect', function (m) { return !m.res || m.res === type; });
    dirty = true;
  }

  /* --------------------------------------------------------------- пассажир */
  let passengerMesh = null;
  function passengerVisual(on, at) {
    if (!on) { if (passengerMesh) { passengerMesh.dispose(); passengerMesh = null; } return; }
    if (passengerMesh) return;
    const pad = at || (X.passenger ? destinations[X.passenger.from].pad : null);
    if (!pad) return;
    const g = new B.TransformNode('Passenger', scene);
    g.position.set(pad.x + 1.4, 0, pad.z + 1.2);
    cyl('Passenger body', 0, .55, 0, .5, 1.1, '#c76b5a', g, { tessellation: 10 });
    sphere('Passenger head', 0, 1.25, 0, .3, .32, .3, '#e8c39d', g);
    box('Passenger suitcase', .42, .22, 0, .3, .4, .22, '#7d6552', g);
    passengerMesh = g;
  }

  /* ------------------------------------------------------------------ тик */
  function tick(dt, now, speed, climbing) {
    collectCd = Math.max(0, collectCd - dt);
    const pos = ctx.position();
    // Топливо: расход в полёте, заправка у депо и на станциях.
    let refuelling = false;
    const nearDepot = Math.hypot(pos.x - depotPad.x, pos.z - depotPad.z) < 4.6 && pos.y < 5;
    let nearStation = false;
    if (!nearDepot) {
      for (let i = 0; i < stations.length; i++) {
        if (Math.hypot(pos.x - stations[i].x, pos.z - stations[i].z) < 3.6 && pos.y < 5) { nearStation = true; break; }
      }
    }
    if (nearDepot || nearStation) {
      if (X.fuel < fuelCap()) {
        X.fuel = Math.min(fuelCap(), X.fuel + 26 * dt);
        refuelling = true;
      }
    } else if (speed > 0.4 || climbing) {
      X.fuel = Math.max(0, X.fuel - (0.42 + (climbing ? 0.3 : 0) + Math.min(1, speed / 30) * 0.35) * dt);
    }
    if (X.fuel <= 0.01) {
      // Топливо кончилось: подъём блокируется, появляется буксир.
      ctx.limitClimb();
      if (now - emptyWarned > 8) {
        emptyWarned = now;
        message(tr('Топливо закончилось. Спускайтесь к депо или вызовите буксир.', 'Out of fuel. Glide to the depot or call the tow.'));
      }
      if (towArmed && now - towArmed > 1.2) {
        towArmed = 0;
        X.fuel = Math.max(30, Math.round(fuelCap() * 0.35));
        ctx.teleport(depotPad.x, 4, depotPad.z + 4);
        message(tr('Буксир доставил дрон в депо.', 'The tow brought the drone back to the depot.'));
      }
    } else towArmed = 0;

    // Узлы: сбор рядом с узлом, восстановление через время.
    nodes.forEach(function (n) {
      if (n.readyAt > now) return;
      if (Math.hypot(pos.x - n.x, pos.z - n.z) < collectRadius() && pos.y < 4.6 && speed < 6.5 && collectCd <= 0) {
        collectCd = 0.5;
        n.readyAt = now + 42;
        nodeVisible(n, false);
        if (n.type === 'fuel') {
          X.fuel = Math.min(fuelCap(), X.fuel + 30);
          message(tr('Канистра с топливом: +30', 'Fuel canister: +30'));
        } else {
          onCollect(n.type, 2);
        }
        dirty = true;
      }
    });
    nodes.forEach(function (n) {
      if (n.readyAt && n.readyAt <= now) { n.readyAt = 0; nodeVisible(n, true); }
      if (n.g && n.readyAt === 0 && n.meshes.length) n.g.rotation.y = Math.sin((now + n.bob) * 0.6) * 0.12;
    });

    // Пассажир: посадка и высадка на площадках.
    if (X.passenger) {
      const p = X.passenger;
      const target = p.taken ? destinations[p.to].pad : destinations[p.from].pad;
      const near = Math.hypot(pos.x - target.x, pos.z - target.z) < boardRadius() && pos.y < 4.2;
      if (near && speed < 2.4 && !p.taken) {
        p.taken = true;
        passengerVisual(false);
        message(tr('Пассажир на борту: ', 'Passenger aboard: ') + destinations[p.to].name);
        progress('passenger', function (m) { return m.id === p.mission; });
        dirty = true;
      } else if (near && speed < 2.4 && p.taken) {
        X.stats.passengers++;
        message(tr('Пассажир доставлен: ', 'Passenger delivered: ') + destinations[p.to].name);
        X.passenger = null;
        passengerVisual(false);
        ensureMissions();
        dirty = true;
      }
      passengerVisual(!!X.passenger, p.taken ? null : destinations[p.from].pad);
    } else if (passengerMesh) passengerVisual(false);

    if (Math.abs(X.fuel - lastFuel) > 0.5) { lastFuel = X.fuel; dirty = true; }
    if (dirty) { dirty = false; paint(); }
  }

  /* ------------------------------------------------------------------- HUD */
  const style = document.createElement('style');
  style.id = 'sky-logistics-style';
  style.textContent = `
  /* Компактная панель доставки: карточка миссии уменьшена и складывается. */
  .hud .mission{width:268px;padding:10px 12px;border-radius:13px;top:88px;left:16px}
  .hud .mission h2{font-size:14px;margin:5px 0 4px}
  .hud .mission p{font-size:10.5px;line-height:1.45}
  .hud .mission .eyebrow{font-size:8px}
  .hud .mission.collapsed{padding:7px 10px}
  .hud .mission.collapsed h2,.hud .mission.collapsed p,.hud .mission.collapsed .progress,
  .hud .mission.collapsed small{display:none}
  .mission .collapse{position:absolute;right:8px;top:8px;width:22px;height:22px;border-radius:7px;
    border:1px solid #b9c8bd66;background:#fff8;color:#4d6a5e;font:700 12px/1 system-ui;cursor:pointer}
  #lgPanel{position:absolute;left:16px;bottom:16px;z-index:12;width:266px;padding:10px 12px;border-radius:14px;
    background:#fbf8edf2;border:1px solid #fff9;box-shadow:0 8px 26px #38575a12;font:500 11px/1.4 system-ui;
    color:#46584f;display:flex;flex-direction:column;gap:7px}
  #lgFuel{display:flex;align-items:center;gap:8px}
  #lgFuel b{font-size:10px;letter-spacing:.6px;color:#7d9184;font-weight:700}
  #lgFuelTrack{flex:1;height:7px;border-radius:99px;background:#dcd9c6;overflow:hidden}
  #lgFuelFill{height:100%;width:100%;background:linear-gradient(90deg,#d7a14b,#8fbf6f);transition:width .2s}
  #lgFuel.low #lgFuelFill{background:linear-gradient(90deg,#c2604f,#d7a14b)}
  #lgRes{display:flex;gap:6px}
  #lgRes span{flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:3px 0;border-radius:8px;
    background:#fff8;border:1px solid #ded9c4;font-weight:700;font-size:11px;color:#5a6b60}
  #lgRes i{width:9px;height:9px;border-radius:3px;display:inline-block}
  #lgMissions{display:flex;flex-direction:column;gap:4px}
  .lgMission{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:8px;background:#fff9;border:1px solid #e2ddc9}
  .lgMission .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px}
  .lgMission .p{font-size:10px;font-weight:800;color:#7a8f79}
  #lgButtons{display:flex;gap:6px}
  #lgButtons button{flex:1;padding:6px 0;border-radius:9px;border:1px solid #cfd6c2;background:#fff;color:#49625a;
    font:700 10.5px system-ui;cursor:pointer}
  #lgButtons button:active{background:#e9eddd}
  #lgTow{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:13;padding:9px 16px;border-radius:12px;
    border:0;background:#c2604f;color:#fff;font:800 12px system-ui;cursor:pointer;box-shadow:0 8px 22px #0003;display:none}
  #lgTow.on{display:block}
  #lgStation{position:fixed;inset:0;z-index:45;background:#385b6259;display:none;place-items:center;padding:16px}
  #lgStation.on{display:grid}
  #lgStationCard{width:340px;max-width:100%;max-height:78dvh;overflow:auto;background:#fbf8ed;border-radius:16px;
    padding:14px 15px;box-shadow:0 18px 60px #254a5533;font:500 11.5px/1.45 system-ui;color:#4a5c53}
  #lgStationCard h3{font-size:15px;margin:0 0 8px;color:#3d5148}
  .lgRow{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid #e4dfca}
  .lgRow .n{flex:1;min-width:0}
  .lgRow .n b{display:block;font-size:11.5px}
  .lgRow .n small{color:#7d9184;font-size:10px}
  .lgRow button{padding:5px 9px;border-radius:8px;border:1px solid #cfd6c2;background:#fff;color:#49625a;font:700 10.5px system-ui;cursor:pointer}
  .lgRow button[disabled]{opacity:.45;cursor:default}
  #lgClose{float:right;border:0;background:#0000;font:700 15px system-ui;color:#7d9184;cursor:pointer}
  @media (max-width:720px){
    .hud .mission{width:calc(100% - 140px);left:10px;top:74px}
    #lgPanel{width:214px;left:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));padding:8px 9px;gap:5px}
    .lgMission .t{font-size:10px}
  }
  @media (max-height:520px){#lgPanel{bottom:8px;width:200px}#lgRes{gap:4px}}
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'lgPanel';
  panel.innerHTML =
    '<div id="lgFuel"><b>' + tr('ТОПЛИВО', 'FUEL') + '</b><div id="lgFuelTrack"><div id="lgFuelFill"></div></div><b id="lgFuelVal">100</b></div>' +
    '<div id="lgRes"></div>' +
    '<div id="lgMissions"></div>' +
    '<div id="lgButtons"><button type="button" id="lgStationBtn">' + tr('СТАНЦИЯ', 'STATION') + '</button>' +
    '<button type="button" id="lgMapBtn">' + tr('КАРТА', 'MAP') + '</button></div>';
  /* Панель живёт в body, а не в .hud: у hud стоит pointer-events:none и он
     скрывается на время интро, из-за чего кнопки панели были бы недоступны. */
  document.body.appendChild(panel);

  const tow = document.createElement('button');
  tow.id = 'lgTow';
  tow.type = 'button';
  tow.textContent = tr('ВЫЗВАТЬ БУКСИР', 'CALL THE TOW');
  tow.addEventListener('click', function () { towArmed = performance.now() / 1000; tow.textContent = tr('Буксир в пути…', 'Tow on the way…'); });
  document.body.appendChild(tow);

  const station = document.createElement('div');
  station.id = 'lgStation';
  station.innerHTML = '<div id="lgStationCard"><button type="button" id="lgClose">×</button><h3>' + tr('Станция и улучшения', 'Station and upgrades') + '</h3><div id="lgStationBody"></div></div>';
  document.body.appendChild(station);

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function paint(force) {
    const fill = $('lgFuelFill'), wrap = $('lgFuel');
    if (fill) {
      const pct = Math.max(0, Math.min(100, (X.fuel / fuelCap()) * 100));
      fill.style.width = pct.toFixed(1) + '%';
      if (wrap) wrap.classList.toggle('low', pct < 25);
    }
    const val = $('lgFuelVal');
    if (val) val.textContent = Math.round(X.fuel);
    const res = $('lgRes');
    if (res) {
      res.innerHTML = RES.map(function (k) {
        return '<span><i style="background:' + resColor[k] + '"></i>' + X.res[k] + '</span>';
      }).join('');
    }
    const list = $('lgMissions');
    if (list) {
      list.innerHTML = X.missions.map(function (m) {
        return '<div class="lgMission"><span class="t">' + esc(m.title) + '</span><span class="p">' +
          Math.min(m.have, m.need) + '/' + m.need + '</span></div>';
      }).join('');
    }
    if (tow) tow.classList.toggle('on', X.fuel <= 0.01);
    const body = $('lgStationBody');
    if (body && (force || body.dataset.open === '1')) {
      body.innerHTML = Object.keys(UPG).map(function (k) {
        const lvl = X.up[k], max = lvl >= MAX_UP;
        const cost = upCost(k);
        return '<div class="lgRow"><div class="n"><b>' + esc(UPG[k].name) + ' · ' + lvl + '/' + MAX_UP + '</b><small>' +
          esc(UPG[k].note) + '</small><small>' + (max ? tr('максимум', 'maximum') : esc(costText(cost))) + '</small></div>' +
          '<button type="button" data-up="' + k + '"' + (max || !canPay(cost) ? ' disabled' : '') + '>' +
          (max ? '✓' : tr('Улучшить', 'Upgrade')) + '</button></div>';
      }).join('');
      body.querySelectorAll('[data-up]').forEach(function (b) {
        b.addEventListener('click', function () { upgrade(b.dataset.up); });
      });
    }
  }
  $('lgStationBtn') && $('lgStationBtn').addEventListener('click', function () {
    const body = $('lgStationBody');
    if (body) body.dataset.open = '1';
    station.classList.add('on');
    paint(true);
  });
  $('lgClose') && $('lgClose').addEventListener('click', function () {
    station.classList.remove('on');
    const body = $('lgStationBody');
    if (body) body.dataset.open = '0';
  });
  $('lgMapBtn') && $('lgMapBtn').addEventListener('click', function () {
    const card = document.querySelector('.map-card');
    if (card) card.classList.toggle('lg-hide');
  });

  /* Сворачивание карточки доставки: игрок видит мир, а не панель. */
  const missionCard = document.querySelector('.hud .mission');
  if (missionCard && !missionCard.querySelector('.collapse')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'collapse';
    btn.textContent = '–';
    btn.setAttribute('aria-label', tr('Свернуть окно доставки', 'Collapse the delivery window'));
    btn.addEventListener('click', function () {
      missionCard.classList.toggle('collapsed');
      btn.textContent = missionCard.classList.contains('collapsed') ? '+' : '–';
    });
    missionCard.appendChild(btn);
  }

  /* Короткая подсказка при первом запуске: три строки, которые объясняют
     правила и исчезают навсегда после нажатия. */
  let hintSeen = false;
  try { hintSeen = localStorage.getItem('vg_sky_logistics_hint') === '1'; } catch (e) {}
  if (!hintSeen) {
    const hint = document.createElement('div');
    hint.id = 'lgHint';
    hint.innerHTML = '<b>' + tr('Как играть', 'How to play') + '</b><span>' +
      tr('Летите к зелёному кругу у депо и зависните — посылка поднимется на борт. Затем снизьтесь над кругом адреса: доставка засчитается сама.',
        'Fly to the green circle by the depot and hover — the parcel boards. Then descend over the address ring: the delivery counts automatically.') +
      '</span><span>' + tr('Топливо: заправка у депо и на жёлтых стойках. Ресурсы собираются рядом с островами.',
        'Fuel: refuel at the depot and yellow stands. Resources are collected next to the islands.') +
      '</span><span>' + tr('Слева — миссии и улучшения станции. Награда за доставку — 5 V на аккаунт.',
        'On the left: missions and station upgrades. A delivery pays 5 V to your account.') +
      '</span><button type="button">' + tr('Понятно', 'Got it') + '</button>';
    document.body.appendChild(hint);
    hint.querySelector('button').addEventListener('click', function () {
      hint.remove();
      try { localStorage.setItem('vg_sky_logistics_hint', '1'); } catch (e) {}
    });
    style.textContent += `
    #lgHint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:46;width:320px;max-width:calc(100% - 32px);
      background:#fbf8ed;border-radius:16px;padding:14px 16px;box-shadow:0 20px 60px #254a5540;display:flex;
      flex-direction:column;gap:7px;font:500 11.5px/1.5 system-ui;color:#4a5c53}
    #lgHint b{font-size:14px;color:#3d5148}
    #lgHint button{align-self:flex-end;padding:6px 14px;border-radius:9px;border:0;background:#7ba58a;color:#fff;
      font:800 11px system-ui;cursor:pointer}`;
  }

  paint(true);
  return {
    tick: tick, paint: function () { paint(false); }, upgrade: upgrade,
    onPickup: onPickup, onDeliver: onDeliver,
    state: X, nodes: nodes, stations: stations, UPG: UPG, upCost: upCost,
    fuelCap: fuelCap, resCap: resCap, collectRadius: collectRadius, boardRadius: boardRadius,
    addRes: addRes, completeMission: completeMission, ensureMissions: ensureMissions,
    makeMission: makeMission, progress: progress, onCollect: onCollect, canPay: canPay, costText: costText
  };
}

  /* Экземпляр логистики: топливо, ресурсы, миссии, пассажиры и станции. */
  const LOG = skyLogistics({
    B, scene, box, cyl, sphere, torus, mat, destinations, depotPad, S, message, $, tr, sign,
    position: () => S.position,
    limitClimb: () => { S.velocity.y = Math.min(S.velocity.y, 0); },
    teleport: (x, y, z) => { S.position.set(x, y, z); S.velocity.set(0, 0, 0); }
  });

 let mode='intro',time=0,rewardClock=0,saveClock=0,uiClock=0,dwell=0,toastEnd=0,contactCooldown=0,helpResume=false,drop=null,runLoop=true;
 let keys={},stick={id:null,x:0,y:0},altOwners=new Map(),lookPointer=null;
 const cam={yaw:Math.PI,pitch:.38,distance:16,cyaw:Math.PI,cpitch:.38,cdistance:16};
 function clearInput(){keys={};stick.id=null;stick.x=stick.y=0;lookPointer=null;if(typeof document.exitPointerLock==='function'&&document.pointerLockElement===canvas){try{document.exitPointerLock()}catch(e){}}$('nub').style.transform='translate(0,0)';for(const [id,b]of altOwners){try{if(b.hasPointerCapture(id))b.releasePointerCapture(id)}catch{}b.classList.remove('held')}altOwners.clear()}
 function message(text){$('toast').textContent=text;$('toast').classList.add('show');toastEnd=time+4.5}
 function receipt(){return globalThis.crypto?.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)})}
 function syncRewards(){if(!accountName||parent===window)return;for(const id of S.pending)parent.postMessage({type:'skyDeliveryReward',game:'skyisle',amount:5,deliveryId:id,account:accountName},location.origin==='null'?'*':location.origin)}
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='skyDeliveryAck'||e.data.account!==accountName||e.data.amount!==5)return;const id=e.data.deliveryId;if(S.pending.includes(id)){S.pending=S.pending.filter(v=>v!==id);save();updateUI()}});
 function distanceText(d){return d>=1000?(d/1000).toFixed(2)+tr(' км',' km'):Math.round(d)+tr(' м',' m')}
 function activePad(){return S.order===null?depotPad:destinations[S.order].pad}
 function refreshTarget(){cargo.setEnabled(S.order!==null);const pad=activePad();deliveryRing.setEnabled(S.order!==null);innerRing.setEnabled(S.order!==null);dropDisk.setEnabled(S.order!==null);for(const m of [deliveryRing,innerRing,dropDisk]){m.position.x=pad.x;m.position.z=pad.z}beacon.position.set(pad.x,1.1,pad.z);marker.background=S.order===null?'#477c66e8':'#866844ed'}
 function pickup(){LOG.onPickup();S.order=S.next%destinations.length;S.next++;dwell=0;S.legLength=Math.hypot(S.position.x-destinations[S.order].pad.x,S.position.z-destinations[S.order].pad.z);refreshTarget();save();message(tr('Посылка на борту: ','Parcel aboard: ')+destinations[S.order].note+'.')}
 function deliver(){if(S.order===null)return;LOG.onDeliver();const address=destinations[S.order];S.score++;S.earned+=5;if(accountName)S.pending.push(receipt());if(drop)drop.g.dispose();drop={g:parcel(null),start:S.position.clone().add(new B.Vector3(0,-.66,0)),target:new B.Vector3(address.pad.x,.39,address.pad.z),age:0};drop.g.position.copyFrom(drop.start);S.order=null;dwell=0;S.legLength=Math.hypot(S.position.x-depotPad.x,S.position.z-depotPad.z);refreshTarget();save();syncRewards();message(tr('Посылка доставлена! +5 монет. Обратный рейс — в депо.','Parcel delivered! +5 coins. Return to the depot.'))}
 function resolve(p){const radius=.95;for(const c of colliders){if(p.y+.6<c.bottom||p.y-.7>c.top)continue;const dx=p.x-c.x,dz=p.z-c.z,len=Math.hypot(dx,dz),limit=c.r+radius;if(len<limit){const fromAbove=S.position.y-.7>=c.top-.12&&p.y<S.position.y;if(fromAbove){p.y=Math.min(20,c.top+.71);S.velocity.y=Math.max(0,S.velocity.y)}else{const nx=len>.001?dx/len:1,nz=len>.001?dz/len:0;p.x=c.x+nx*limit;p.z=c.z+nz*limit;const dot=S.velocity.x*nx+S.velocity.z*nz;if(dot<0){S.velocity.x-=dot*nx;S.velocity.z-=dot*nz}}if(contactCooldown<=0&&c.type!=='tree'){message(tr('Мягкая остановка. Облетите сбоку или поднимитесь выше.','A gentle stop. Fly around the side or a little higher.'));contactCooldown=6}}}
  // Soft capsule collisions with the slowly rotating windmill blades.
  for(const m of mills){const dz=p.z-(m.z+1.45);if(Math.abs(dz)>1.15||Math.hypot(p.x-m.x,p.y-m.height)>6.1)continue;for(let i=0;i<4;i++){const a=m.angle+i*Math.PI/2,ux=-Math.sin(a),uy=Math.cos(a),dx=p.x-m.x,dy=p.y-m.height,t=Math.max(.45,Math.min(5.15,dx*ux+dy*uy)),qx=m.x+ux*t,qy=m.height+uy*t;if(Math.hypot(p.x-qx,p.y-qy,dz)<1.1){p.z=m.z+1.45+(dz>=0?1.15:-1.15);S.velocity.z=0;break}}}
  p.y=Math.max(1.5,Math.min(20,p.y));if((p.y===1.5&&S.velocity.y<0)||(p.y===20&&S.velocity.y>0))S.velocity.y=0;const r=Math.hypot(p.x,p.z);if(r>arch.worldRadius){p.x*=arch.worldRadius/r;p.z*=arch.worldRadius/r;const outward=(S.velocity.x*p.x+S.velocity.z*p.z)/arch.worldRadius;if(outward>0){S.velocity.x-=outward*p.x/arch.worldRadius;S.velocity.z-=outward*p.z/arch.worldRadius}}return p;
 }
 const map=$('map').getContext('2d');function drawMap(){const c=144,k=134/arch.worldRadius;map.clearRect(0,0,288,288);map.fillStyle='#c6d9db';map.beginPath();map.arc(c,c,143,0,7);map.fill();map.strokeStyle='#eff1e655';map.lineWidth=1;for(let r=35;r<145;r+=35){map.beginPath();map.arc(c,c,r,0,7);map.stroke()}for(const isle of arch.islands){map.fillStyle=isle.major?'#90a37a':'#acb79a';map.beginPath();map.arc(c+isle.x*k,c+isle.z*k,Math.max(2,isle.r*k),0,7);map.fill()}for(const d of destinations){map.fillStyle=S.order===d.id?'#ac793f':'#6d8277';map.fillRect(c+d.x*k-2.5,c+d.z*k-2.5,5,5)}map.fillStyle='#507d92';map.fillRect(c-4,c-4,8,8);const pad=activePad();map.strokeStyle=S.order===null?'#557b69':'#b28148';map.lineWidth=2;map.beginPath();map.arc(c+pad.x*k,c+pad.z*k,8+Math.sin(time*2),0,7);map.stroke();map.setLineDash([3,4]);map.beginPath();map.moveTo(c+S.position.x*k,c+S.position.z*k);map.lineTo(c+pad.x*k,c+pad.z*k);map.stroke();map.setLineDash([]);map.save();map.translate(c+S.position.x*k,c+S.position.z*k);map.rotate(-S.heading);map.fillStyle='#fff5df';map.strokeStyle='#3e645c';map.lineWidth=1.7;map.beginPath();map.moveTo(0,7);map.lineTo(-4,-4);map.lineTo(4,-4);map.closePath();map.fill();map.stroke();map.restore()}
 function updateUI(){const d=S.order===null?null:destinations[S.order],p=activePad(),distance=Math.hypot(S.position.x-p.x,S.position.z-p.z);$('score').textContent=S.score;$('earned').textContent=S.earned;$('rewardHint').textContent=S.pending.length?tr('Зачисляем на аккаунт…','Syncing account…'):accountName?tr('На аккаунт · +5 V за рейс','Account · +5 V per delivery'):tr('Локальные монеты · +5 V','Local coins · +5 V');$('missionTag').textContent=d?tr('ПОСЫЛКА НА БОРТУ','PARCEL ABOARD'):tr('ПОЧТОВАЯ СЛУЖБА','POSTAL SERVICE');$('missionTitle').textContent=d?d.name:tr('Пора за посылкой','Time for a parcel');$('missionHint').textContent=distance<3.3?(S.position.y>3.4?tr('Снизьтесь ниже 3,4 м и зависните в круге.','Descend below 3.4 m and hover in the circle.'):tr('Отпустите движение. Передаём посылку…','Let go of the controls. Handing over…')):d?tr('Крейсерский полёт: 8–16 м. Следуйте к удалённому острову.','Cruise at 8–16 m. Follow the route to the destination island.'):tr('Подлетите к зелёному кругу у Почтового Депо.','Fly to the green circle at the Postal Depot.');$('routeName').textContent=d?d.note:tr('Почтовое Депо','Postal Depot');$('distance').textContent=distanceText(distance);const seconds=Math.ceil(distance/arch.speed);$('routeDetails').textContent=(seconds>=60?'~'+Math.ceil(seconds/60)+tr(' мин полёта',' min flight'):'~'+seconds+tr(' с полёта',' s flight'))+' · '+tr('без ограничения времени','no deadline');$('routeFill').style.width=Math.max(0,Math.min(100,(1-distance/S.legLength)*100))+'%';$('speed').textContent=Math.round(Math.hypot(S.velocity.x,S.velocity.z)*3.6)+tr(' км/ч',' km/h');$('bearing').style.transform='rotate('+(Math.atan2(p.x-S.position.x,p.z-S.position.z)-cam.cyaw)+'rad)';$('handoffProgress').style.width=Math.min(1,dwell/.9)*100+'%';$('altitude').textContent=S.position.y.toFixed(1)+tr(' м',' m');$('cargoStatus').textContent=d?tr('1 ПОСЫЛКА','1 PARCEL'):tr('БЕЗ ГРУЗА','NO CARGO');markerText.text=(d?d.name:tr('Почтовое Депо','Postal Depot'))+' · '+distanceText(distance);marker.isVisible=mode==='playing'&&distance>3;drawMap()}
 function update(dt){dt=Math.min(.06,Math.max(0,dt));if(mode==='playing'){time+=dt;contactCooldown=Math.max(0,contactCooldown-dt);const f=Number(!!(keys.KeyW||keys.ArrowUp))-Number(!!(keys.KeyS||keys.ArrowDown))-stick.y,r=Number(!!(keys.KeyD||keys.ArrowRight))-Number(!!(keys.KeyA||keys.ArrowLeft))+stick.x,mag=Math.max(1,Math.hypot(f,r)),up=Number(!!(keys.Space||keys.ShiftLeft||keys.ShiftRight||[...altOwners.values()].includes($('up'))))-Number(!!(keys.KeyC||keys.ControlLeft||keys.ControlRight||[...altOwners.values()].includes($('down'))));const forward=new B.Vector3(Math.sin(cam.cyaw),0,Math.cos(cam.cyaw)),right=new B.Vector3(Math.cos(cam.cyaw),0,-Math.sin(cam.cyaw)),wish=forward.scale(f/mag*arch.speed).add(right.scale(r/mag*arch.speed));wish.y=up*5.2;S.velocity=B.Vector3.Lerp(S.velocity,wish,1-Math.exp(-4.5*dt));const p=S.position.add(S.velocity.scale(dt));S.position.copyFrom(resolve(p));const speed=Math.hypot(S.velocity.x,S.velocity.z);if(speed>.2){const goal=Math.atan2(S.velocity.x,S.velocity.z),delta=Math.atan2(Math.sin(goal-S.heading),Math.cos(goal-S.heading));S.heading+=delta*(1-Math.exp(-6*dt))}body.rotation.x=B.Scalar.Lerp(body.rotation.x,speed*.023,1-Math.exp(-6*dt));body.rotation.z=B.Scalar.Lerp(body.rotation.z,-(Math.cos(S.heading)*S.velocity.x-Math.sin(S.heading)*S.velocity.z)*.027,1-Math.exp(-6*dt));
  LOG.tick(dt,time,Math.hypot(S.velocity.x,S.velocity.y,S.velocity.z),up>0);const pad=activePad(),near=Math.hypot(S.position.x-pad.x,S.position.z-pad.z)<3.05;if(near&&S.position.y<=3.4&&speed<2.2&&Math.abs(S.velocity.y)<1.4){dwell+=dt;if(dwell>=.9){if(S.order===null)pickup();else deliver()}}else dwell=0;
  rewardClock+=dt;if(rewardClock>3){rewardClock=0;syncRewards()}saveClock+=dt;if(saveClock>3){saveClock=0;save()}
 }else if(mode==='intro')time+=dt;
 sun.position.set(S.position.x-55,85,S.position.z-45);
 drone.position.copyFrom(S.position);drone.rotation.y=S.heading;
 if(mode==='playing'||mode==='intro'){for(let i=0;i<rotors.length;i++)rotors[i].rotation.y+=dt*(i%2?30:-30);for(const m of mills){m.angle+=dt*.26;m.rotor.rotation.z=m.angle}for(const c of clouds){c.g.position.x=c.x+Math.sin(time*.014+c.phase)*5;c.g.position.z=c.z+Math.cos(time*.011+c.phase)*3}}
 if(drop&&mode==='playing'){drop.age+=dt;const f=Math.min(1,drop.age/.7);drop.g.position.copyFrom(B.Vector3.Lerp(drop.start,drop.target,1-(1-f)**2));drop.g.rotation.y=drop.age*.9;if(drop.age>1.9){drop.g.dispose();drop=null}}
 const pulse=1+Math.sin(time*2.1)*.025;deliveryRing.scaling.set(pulse,1,pulse);depotRing.scaling.set(pulse,1,pulse);innerRing.rotation.y=time*.2;
 const a=1-Math.exp(-10*dt);cam.cyaw+=(cam.yaw-cam.cyaw)*a;cam.cpitch+=(cam.pitch-cam.cpitch)*a;cam.cdistance+=(cam.distance-cam.cdistance)*a;
 if(mode==='intro'){camera.position.set(Math.sin(.7+time*.024)*182,95,Math.cos(.7+time*.024)*182);camera.setTarget(new B.Vector3(0,-8,0))}
 else{const horizontal=cam.cdistance*Math.cos(cam.cpitch),wanted=S.position.add(new B.Vector3(-Math.sin(cam.cyaw)*horizontal,Math.sin(cam.cpitch)*cam.cdistance,-Math.cos(cam.cyaw)*horizontal));wanted.y=Math.max(1.2,wanted.y);camera.position.copyFrom(B.Vector3.Lerp(camera.position,wanted,1-Math.exp(-8*dt)));camera.setTarget(S.position.add(new B.Vector3(0,.3,0)))}
 uiClock+=dt;if(uiClock>.08){uiClock=0;updateUI()}if(time>toastEnd)$('toast').classList.remove('show');
 }
 function pause(){if(mode!=='playing')return;mode='paused';document.body.dataset.mode=mode;clearInput();save();$('pauseModal').hidden=false;marker.isVisible=false}
 function start(){syncRewards();mode='playing';document.body.dataset.mode=mode;$('intro').hidden=true;$('pauseModal').hidden=true;clearInput();updateUI()}
 function help(){helpResume=mode==='playing';if(helpResume){mode='help';document.body.dataset.mode=mode;save()}clearInput();$('helpModal').hidden=false;marker.isVisible=false}
 function closeHelp(){$('helpModal').hidden=true;if(helpResume)start();helpResume=false}
 function resetCamera(){cam.yaw=cam.cyaw+Math.atan2(Math.sin(S.heading-cam.cyaw),Math.cos(S.heading-cam.cyaw));cam.pitch=.38;cam.distance=16}
 $('start').onclick=start;$('pause').onclick=pause;$('resume').onclick=start;$('help').onclick=help;$('closeHelp').onclick=closeHelp;$('helpDone').onclick=closeHelp;$('resetCamera').onclick=resetCamera;$('home').onclick=()=>{save();clearInput();if(parent!==window)parent.postMessage({type:'home',game:'skyisle'},location.origin==='null'?'*':location.origin);else location.href='../index.html'};
 /* Платформа пробрасывает клавиши в игру синтетическим событием на document:
   у такого события e.target — сам документ, а не элемент, и e.target.matches
   падает с TypeError, из-за чего нажатие терялось. Проверяем защищённо. */
document.addEventListener('keydown',e=>{const t=e.target;if(t&&t.matches&&t.matches('input,textarea,select'))return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlLeft','ControlRight','KeyC'].includes(e.code))e.preventDefault();if(e.code==='Escape'){if(!$('helpModal').hidden)closeHelp();else if(mode==='playing')pause();else if(mode==='paused')start();return}if(mode!=='playing')return;keys[e.code]=true;if(!e.repeat&&e.code==='KeyR')resetCamera()});document.addEventListener('keyup',e=>{keys[e.code]=false});
 /* Обзор. Сцена Babylon по умолчанию левосторонняя: при камере, которая смотрит
    в -Z, экранное «вправо» — это -X. Поэтому тянуть мышь вправо значит
    увеличивать yaw (взгляд уходит вправо), влево — уменьшать; вверх/вниз — наклон.
    После нескольких пикселей указатель захватывается (Pointer Lock), чтобы обзор
    не обрывался на краю канваса. Движение дрона считается от cam.cyaw и не меняется. */
 const LOOK_SPEED=.005,TILT_SPEED=.004,LOCK_AFTER=6;
 function lookBy(dx,dy){cam.yaw+=dx*LOOK_SPEED;cam.pitch=Math.max(.08,Math.min(1.25,cam.pitch+dy*TILT_SPEED))}
 function dropLookLock(){if(typeof document.exitPointerLock==='function'&&document.pointerLockElement===canvas){try{document.exitPointerLock()}catch(e){}}}
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('pointerdown',e=>{if(mode!=='playing'||lookPointer)return;if(e.pointerType!=='touch'&&e.button!==0&&e.button!==2)return;e.preventDefault();lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0,type:e.pointerType};canvas.setPointerCapture(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(!lookPointer||lookPointer.id!==e.pointerId||mode!=='playing')return;if(document.pointerLockElement===canvas)return;const dx=e.clientX-lookPointer.x,dy=e.clientY-lookPointer.y;lookBy(dx,dy);lookPointer.x=e.clientX;lookPointer.y=e.clientY;lookPointer.moved+=Math.hypot(dx,dy);if(lookPointer.type==='mouse'&&lookPointer.moved>LOCK_AFTER&&typeof canvas.requestPointerLock==='function'){try{const pending=canvas.requestPointerLock();if(pending&&typeof pending.catch==='function')pending.catch(()=>{})}catch(err){}}});
 document.addEventListener('mousemove',e=>{if(!lookPointer||mode!=='playing'||document.pointerLockElement!==canvas)return;lookBy(e.movementX||0,e.movementY||0)});
 document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&lookPointer)lookPointer=null});
 for(const ev of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(ev,e=>{if(lookPointer?.id!==e.pointerId)return;lookPointer=null;dropLookLock()});
canvas.addEventListener('wheel',e=>{if(mode!=='playing')return;e.preventDefault();cam.distance=Math.max(9,Math.min(24,cam.distance*Math.exp(e.deltaY*.001)))},{passive:false});
 function moveStick(e){if(e.pointerId!==stick.id)return;const r=$('stick').getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,d=Math.hypot(x,y),limit=34,k=d>limit?limit/d:1;stick.x=d>5?x*k/limit:0;stick.y=d>5?y*k/limit:0;$('nub').style.transform='translate('+x*k+'px,'+y*k+'px)'}$('stick').addEventListener('pointerdown',e=>{if(mode!=='playing'||stick.id!==null)return;e.preventDefault();stick.id=e.pointerId;$('stick').setPointerCapture(e.pointerId);moveStick(e)});$('stick').addEventListener('pointermove',moveStick);for(const ev of ['pointerup','pointercancel','lostpointercapture'])$('stick').addEventListener(ev,e=>{if(stick.id!==e.pointerId)return;stick.id=null;stick.x=stick.y=0;$('nub').style.transform='translate(0,0)'});
 for(const btn of [$('up'),$('down')]){btn.addEventListener('pointerdown',e=>{if(mode!=='playing')return;e.preventDefault();altOwners.set(e.pointerId,btn);btn.classList.add('held');btn.setPointerCapture(e.pointerId)});for(const ev of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(ev,e=>{if(altOwners.get(e.pointerId)!==btn)return;altOwners.delete(e.pointerId);if(![...altOwners.values()].includes(btn))btn.classList.remove('held')})}
 window.addEventListener('blur',()=>{clearInput();if(mode==='playing')pause()});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='playing')pause()});/* Смена размера окна (в том числе схлопывание адресной строки на телефоне)
   не должна сбрасывать ввод: иначе джойстик «отлипает» прямо под пальцем,
   а зажатая клавиша теряется. Сбрасываем ввод только при потере фокуса,
   уходе вкладки в фон и повороте экрана. */
window.addEventListener('resize',()=>{engine.resize()});
/* Панель браузера (и адресная строка iOS в частности) меняет высоту без события
   resize: тогда canvas остаётся старым по буферу и кадр растягивается. Держим
   буфер в размере видимой области, но НЕ сбрасываем ввод — иначе жест обзора
   обрывается посреди движения. */
let fitPending=0;
const fitStage=()=>{if(fitPending)return;fitPending=requestAnimationFrame(()=>{fitPending=0;try{engine.resize()}catch(e){}})};
window.addEventListener('orientationchange',()=>{setTimeout(fitStage,180);setTimeout(fitStage,420)});
window.addEventListener('pageshow',fitStage);
if(window.visualViewport){visualViewport.addEventListener('resize',fitStage);visualViewport.addEventListener('scroll',fitStage)}
if(window.ResizeObserver&&canvas.parentElement)new ResizeObserver(fitStage).observe(canvas.parentElement);window.addEventListener('pagehide',save);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();message(tr('Восстанавливаем графику…','Restoring graphics…'))});
 refreshTarget();updateUI();$('start').disabled=false;$('loading').textContent=storageOK?tr('Дрон готов. Посылки никуда не спешат.','Drone ready. The parcels are in no hurry.'):tr('Хранилище недоступно: прогресс до закрытия вкладки.','Storage unavailable: progress lasts until this tab closes.');
 engine.runRenderLoop(()=>{if(!runLoop)return;update(engine.getDeltaTime()/1000);scene.render()});

 // --- Графика: параллакс, частицы и свет. Модуль ниже подключается после старта сцены. ---
 const gfx=window.__skyGfx;
 if(gfx&&typeof gfx.attach==='function'){try{gfx.attach(window.skyGame,B)}catch(e){console.warn('graphics upgrade skipped',e)}}
 window.skyGame={arch,syncRewards,state:S,scene,engine,camera,drone,body,cargo,rotors,mills,destinations,depotPad,colliders,cam,get mode(){return mode},get dwell(){return dwell},get input(){return{stick:{...stick},cameraPointer:lookPointer?.id??null,altitudePointers:altOwners.size}},get libraryMode(){return loadingMode},start,pause,update,save,resetCamera,render(){scene.render()},manual(){runLoop=false},resumeLoop(){runLoop=true},stats:{houses:5,addresses:destinations.length,windmills:mills.length,trees:trees+arch.treeCount,islands:arch.islands.length},bounds:{minHeight:1.5,maxHeight:20,radius:arch.worldRadius}};
}catch(err){console.error(err);$('error').hidden=false;$('errorText').textContent=tr('Не удалось подготовить 3D. Нужен современный браузер с WebGL. ','Could not prepare 3D. A modern browser with WebGL is required. ')+(err?.message||String(err));$('loading').textContent=tr('Не удалось запустить игру.','Could not start the game.')}
})();
