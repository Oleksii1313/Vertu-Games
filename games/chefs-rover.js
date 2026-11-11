import * as T from 'three';
import {makeChef,makeResident} from './rover-characters.js';
import {populateAurelia} from './rover-world.js';
import {RoverCamera} from './rover-camera.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
const $=id=>document.getElementById(id), en=new URLSearchParams(location.search).get('lang')==='en', tr=(ru,eng)=>en?eng:ru;
document.documentElement.lang=en?'en':'ru';
document.title=tr('Космокухня: Дороги Аурелии','Cosmic Kitchen: Roads of Aurelia')+' · VertGames';
const desktopMedia=matchMedia('(hover: hover) and (pointer: fine)');function inputMode(){document.body.dataset.input=desktopMedia.matches||!navigator.maxTouchPoints?'desktop':'touch'}inputMode();desktopMedia.addEventListener('change',inputMode);window.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')document.body.dataset.input='touch';else if(e.pointerType==='mouse'&&desktopMedia.matches)document.body.dataset.input='desktop'},{capture:true});
const WORLD=500;
const words={berry:tr('Парящие ягоды','Floating berries'),mushroom:tr('Лунные грибы','Moon mushrooms'),soda:tr('Минералка','Mineral water'),tomato:tr('Солнечные томаты','Sun tomatoes'),root:tr('Сладкий корень','Sweet root'),herb:tr('Душистая зелень','Aromatic herbs'),grain:tr('Звёздное зерно','Star grain'),milk:tr('Лунное молоко','Moon milk'),egg:tr('Яйца небоптиц','Skybird eggs'),salt:tr('Кристальная соль','Crystal salt'),algae:tr('Лазурные водоросли','Azure algae'),spice:tr('Огненные стручки','Fire pods')};
const colors={berry:0xf584bc,mushroom:0xe0b675,soda:0x71c6d3,tomato:0xd65a3d,root:0xe89f4e,herb:0x669851,grain:0xc9af6c,milk:0xebe5c9,egg:0xd8d1af,salt:0xc5dceb,algae:0x368f93,spice:0xc87947};
const recipes=[
{id:0,name:tr('Лунное соте','Moon sauté'),need:{berry:1,mushroom:2},steps:['chop','fry'],price:2,type:'plate'},
{id:1,name:tr('Звёздный лимонад','Starlight lemonade'),need:{berry:2,soda:1},steps:['mix'],price:2,type:'drink'},
{id:2,name:tr('Пирог «Орбита»','Orbit pie'),need:{berry:2,grain:1,egg:1},steps:['wash','chop','mix','bake'],price:6,type:'pie'},
{id:3,name:tr('Каньонная запеканка','Canyon casserole'),need:{mushroom:2,milk:1,salt:1},steps:['wash','chop','fry','bake','season'],price:7,type:'pie',season:1},
{id:4,name:tr('Салат рассвета','Dawn salad'),need:{tomato:2,herb:1},steps:['wash','chop','mix'],price:3,type:'salad'},
{id:5,name:tr('Ягодное облако','Berry cloud'),need:{berry:2,milk:1},steps:['wash','blend'],price:3,type:'drink'},
{id:6,name:tr('Хлеб путешественника','Traveller’s bread'),need:{grain:2,soda:1,salt:1},steps:['mix','bake','season'],price:5,type:'pie',season:1},
{id:7,name:tr('Острый грибной гриль','Spicy mushroom grill'),need:{mushroom:2,root:1,spice:1,salt:1},steps:['wash','chop','fry','season'],price:8,type:'plate',season:2},
{id:8,name:tr('Суп кристальных долин','Crystal valley soup'),need:{root:2,mushroom:1,soda:1,herb:1,salt:1},steps:['wash','chop','boil','mix','season'],price:9,type:'soup',season:1},
{id:9,name:tr('Омлет небоптиц','Skybird omelette'),need:{egg:2,milk:1,tomato:1,herb:1},steps:['wash','chop','mix','fry'],price:7,type:'plate'},
{id:10,name:tr('Ризотто двух лун','Two-moon risotto'),need:{grain:2,mushroom:2,milk:1,herb:1,salt:1},steps:['wash','chop','fry','boil','mix','season'],price:11,type:'plate',season:2},
{id:11,name:tr('Королевский океан','Royal ocean'),need:{algae:2,egg:1,root:1,soda:1,spice:1,salt:1},steps:['wash','chop','boil','fry','mix','season'],price:12,type:'soup',season:2},
{id:12,name:tr('Мятный источник','Herbal spring'),need:{herb:2,soda:1,berry:1},steps:['wash','chop','blend'],price:4,type:'drink'},
{id:13,name:tr('Северный ягодный тарт','Northern berry tart'),need:{grain:2,berry:2,egg:1,milk:1},steps:['wash','chop','blend','mix','bake'],price:10,type:'pie'},
{id:14,name:tr('Жаркое экспедитора','Explorer’s roast'),need:{root:2,mushroom:2,tomato:1,spice:1,salt:1},steps:['wash','chop','fry','boil','bake','season'],price:12,type:'plate',season:2},
{id:15,name:tr('Небесный банкет','Celestial banquet'),need:{grain:2,algae:1,egg:2,milk:1,root:1,herb:1,spice:1,salt:1},steps:['wash','chop','blend','fry','mix','boil','bake','season'],price:15,type:'pie',season:2}
];
const species=[tr('Листолики','Leaf folk'),tr('Кристаллиды','Crystallids'),tr('Пухокрылы','Moth folk'),tr('Медузники','Jelly folk'),tr('Механиды','Mechanoids'),tr('Ракушечники','Shell folk'),tr('Небоптицы','Skybirds'),tr('Споровики','Spore folk')];
const folks=[
{id:0,name:tr('Ниа','Nia'),x:-17,z:-12,color:0xaed796,species:0,menu:[0,4,12],taste:tr('Люблю зелень, грибы и лёгкие блюда.','I love herbs, mushrooms and light dishes.')},
{id:1,name:tr('Ори','Ori'),x:58,z:-21,color:0xbba5d5,species:1,menu:[1,3,8],taste:tr('Люблю минералку, горячие супы и соль.','I love mineral water, hot soup and salt.')},
{id:2,name:tr('Мико','Miko'),x:-57,z:-52,color:0xf0b79d,species:2,menu:[2,5,6],taste:tr('Люблю ягоды, молоко и свежую выпечку.','I love berries, milk and fresh pastries.')},
{id:3,name:tr('Луми','Lumi'),x:-215,z:235,color:0x79bcb9,species:3,menu:[11,12,8],taste:tr('Мой дом — болота. Люблю водоросли и супы.','The wetlands are my home. I love algae and soup.')},
{id:4,name:tr('Болт','Bolt'),x:240,z:120,color:0x95aab0,species:4,menu:[7,14,10],taste:tr('Прожарка и точная дозировка — вот мой вкус.','Precise heat and seasoning are my favorites.')},
{id:5,name:tr('Улла','Ulla'),x:-290,z:-190,color:0xd5b787,species:5,menu:[6,8,13],taste:tr('Предпочитаю мягкий хлеб и тёплые супы.','I prefer soft bread and warm soup.')},
{id:6,name:tr('Аэро','Aero'),x:310,z:-260,color:0xa9c7d6,species:6,menu:[9,15,13],taste:tr('Обожаю сложные праздничные блюда с яйцами.','I love elaborate celebratory dishes with eggs.')},
{id:7,name:tr('Порти','Porti'),x:-360,z:85,color:0xbea7bd,species:7,menu:[0,10,14],taste:tr('Грибы, грибы и ещё немного грибов!','Mushrooms, mushrooms, and more mushrooms!')},
{id:8,name:tr('Ирис','Iris'),x:140,z:345,color:0xdeb8d4,species:2,menu:[5,13,15],taste:tr('Сладкое, воздушное и праздничное.','Sweet, airy and festive food, please.')},
{id:9,name:tr('Кварц','Quartz'),x:385,z:310,color:0x9ad0cf,species:1,menu:[3,11,15],taste:tr('Для моей семьи готовь сложные блюда без ошибок.','For my family, make complex dishes without mistakes.')}
];
const solidObjects=[];for(const n of folks)for(let j=0;j<3;j++)solidObjects.push({x:n.x+(j-1)*4,z:n.z-4-Math.abs(j-1),r:2.05});
function resolveScenery(){const radius=S.riding?1.9:.32;for(const o of solidObjects){let dx=S.x-o.x,dz=S.z-o.z,d=Math.hypot(dx,dz),min=o.r+radius;if(d<min){if(d<.0001){dx=1;dz=0;d=1}S.x=o.x+dx/d*min;S.z=o.z+dz/d*min;if(S.riding){S.truck.x=S.x;S.truck.z=S.z;speed*=.6}}}S.x=T.MathUtils.clamp(S.x,-WORLD,WORLD);S.z=T.MathUtils.clamp(S.z,-WORLD,WORLD)}
let storageKey='vg_rover_v1:solo';try{if(parent!==window&&typeof parent.getCurrentUser==='function')storageKey='vg_rover_v1:'+parent.getCurrentUser()}catch{}
let saved=null,storageOK=true;try{saved=JSON.parse(localStorage.getItem(storageKey))}catch{storageOK=false}
const valid=saved&&[1,2].includes(saved.version);
const S={inventory:Object.fromEntries(Object.keys(words).map(k=>[k,0])),completed:0,earned:0,failures:0,dishFaults:[],active:{npc:0,recipe:0},dish:null,cook:null,x:2.6,z:17,heading:0,riding:false,truck:{x:0,z:17,heading:0}};
if(valid){for(const k of Object.keys(words))S.inventory[k]=Math.max(0,Math.min(99,Number(saved.inventory?.[k])||0));S.completed=Math.max(0,Math.min(99999,saved.completed|0));S.earned=Math.max(0,Number(saved.earned) || (saved.version===1?S.completed*2:0));S.failures=Math.max(0,saved.failures|0);S.dishFaults=Array.isArray(saved.dishFaults)?saved.dishFaults.slice(0,12):[];S.x=Math.max(-WORLD,Math.min(WORLD,Number(saved.x)||0));S.z=Math.max(-WORLD,Math.min(WORLD,Number(saved.z)||0));S.heading=Number(saved.heading)||0;S.active=saved.active&&folks[saved.active.npc]&&recipes[saved.active.recipe]?saved.active:null;S.dish=Number.isInteger(saved.dish)&&recipes[saved.dish]?saved.dish:null;if(S.active&&saved.cook&&Number.isInteger(saved.cook.step)&&saved.cook.step>=0&&saved.cook.step<recipes[saved.cook.recipe??S.active.recipe]?.steps.length){S.cook={recipe:recipes[saved.cook.recipe]?saved.cook.recipe:S.active.recipe,errors:[],step:saved.cook.step,chops:0,mix:0,heat:0,oven:0,door:0,...saved.cook};S.cook.heat=0;S.cook.door=0;S.cook.oven=0;}}
// Migrate existing progress without resetting deliveries, recipes or ingredients.
if(valid){
 const oldTruck=saved.truck||{x:S.x,z:S.z,heading:S.heading};
 S.truck={x:T.MathUtils.clamp(Number(oldTruck.x)||0,-WORLD,WORLD),z:T.MathUtils.clamp(Number(oldTruck.z)||0,-WORLD,WORLD),heading:Number(oldTruck.heading)||0};
 S.riding=saved.truck?!!saved.riding:false;
 if(S.riding){S.x=S.truck.x;S.z=S.truck.z;S.heading=S.truck.heading}
 else if(!saved.truck){S.x=S.truck.x+(S.truck.x>90?-2.6:2.6);S.z=S.truck.z}
}
let chosenRecipe=S.cook?.recipe??S.active?.recipe??0,mapWide=false;
function cookingRecipe(){return recipes[S.cook?.recipe??chosenRecipe]||recipes[0]}
let footYaw=S.riding?S.truck.heading:S.heading,trackedKind=null,walkCycle=0;
function save(){try{localStorage.setItem(storageKey,JSON.stringify({version:2,...S}))}catch{storageOK=false;if($('saveNote'))$('saveNote').textContent=tr('Хранилище недоступно: прогресс только до закрытия игры.','Storage unavailable: progress lasts for this session only.')}}
function send(type,amount){if(parent!==window)parent.postMessage({type,amount,game:'rover'},location.origin==='null'?'*':location.origin)}
let mode='intro',view='drive',t=0,last=performance.now(),speed=0,uiClock=0,saveClock=0,toastUntil=0,selected='chop',workHeld=false,knifeKick=0,stir=0,orbit=0,keys={},touch={},nearest=null,soundOn=false,audio=null;
let cameraRig=null,joy={x:0,y:0,id:null};
const driveOwners=new Map();
const stageNames={chop:tr('Нарезка','Chopping'),fry:tr('Сковорода','Frying pan'),mix:tr('Смешивание','Mixing'),bake:tr('Духовка','Oven'),wash:tr('Мойка','Sink'),blend:tr('Блендер','Blender'),boil:tr('Кастрюля','Stockpot'),season:tr('Специи','Seasoning')};
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');toastUntil=t+4.5}
function beep(freq=700){if(!soundOn)return;try{audio??=new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=freq;g.gain.setValueAtTime(.04,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.16);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.18)}catch{}}
function clearInput(){if(cameraRig)cameraRig.clear();joy.x=joy.y=0;joy.id=null;if($('stickNub'))$('stickNub').style.transform='translate(0,0)';keys={};touch={};workHeld=false;for(const [b,id] of driveOwners){try{if(b.hasPointerCapture(id))b.releasePointerCapture(id)}catch{}}driveOwners.clear();document.querySelectorAll('.held').forEach(b=>b.classList.remove('held'))}
const renderer=new T.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.65));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
const scene=new T.Scene();scene.background=new T.Color(0xbacddd);scene.fog=new T.FogExp2(0xbacddd,.0025);
const kitchen=new T.Scene();kitchen.scale.setScalar(.48);kitchen.background=new T.Color(0x293e3b);kitchen.fog=new T.Fog(0x293e3b,24,50);
const camera=new T.PerspectiveCamera(48,1,.1,850);const kitchenCamera=new T.PerspectiveCamera(48,1,.1,70);
scene.add(new T.HemisphereLight(0xe8edf7,0x627b63,1.75));const sun=new T.DirectionalLight(0xffe4bc,3.0);sun.position.set(-35,70,25);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-38,right:38,top:38,bottom:-38,near:.5,far:150});sun.shadow.bias=-.0008;scene.add(sun,sun.target);
kitchen.add(new T.HemisphereLight(0xfff3d8,0x626449,3));const lamp=new T.DirectionalLight(0xffd79c,3);lamp.position.set(0,8,4);kitchen.add(lamp);
const mats=new Map();function mat(c,rough=0.85){const key=c+':'+rough;if(!mats.has(key))mats.set(key,new T.MeshStandardMaterial({color:c,roughness:rough}));return mats.get(key)}
function mesh(g,m,x=0,y=0,z=0,parent=scene){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o}
const boxG=new T.BoxGeometry(1,1,1),ballG=new T.SphereGeometry(1,20,14),coneG=new T.ConeGeometry(1,1,6),cylG=new T.CylinderGeometry(1,1,1,16),leafG=new T.SphereGeometry(1,8,5),stoneG=new T.IcosahedronGeometry(1,1);
function box(parent,x,y,z,w,h,d,c){const o=mesh(boxG,mat(c),x,y,z,parent);o.scale.set(w,h,d);return o}
function ball(parent,x,y,z,r,c){const o=mesh(ballG,mat(c),x,y,z,parent);o.scale.setScalar(r);return o}
function cylinder(parent,x,y,z,r,h,c){const o=mesh(cylG,mat(c),x,y,z,parent);o.scale.set(r,h,r);return o}
function texture(draw,w=256,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;return tx}
function label(text,parent,x,y,z,w=4,bg='#fcf0cd',fg='#33574f'){const tx=texture((g,cw,ch)=>{g.fillStyle=bg;g.fillRect(0,0,cw,ch);g.strokeStyle=fg;g.lineWidth=5;g.strokeRect(7,7,cw-14,ch-14);g.fillStyle=fg;g.textAlign='center';g.textBaseline='middle';g.font='bold 38px Arial, sans-serif';g.fillText(text,cw/2,ch/2,cw-24)},512,128);const o=mesh(new T.PlaneGeometry(w,w/4),new T.MeshBasicMaterial({map:tx,side:T.DoubleSide}),x,y,z,parent);o.castShadow=false;return o}
const groundTex=texture((g,w,h)=>{g.fillStyle='#bbbda2';g.fillRect(0,0,w,h);for(let i=0;i<5800;i++){g.fillStyle=i%2?'#e1d8b944':'#53674d44';g.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*4,1+Math.random()*3)}});groundTex.wrapS=groundTex.wrapT=T.RepeatWrapping;groundTex.repeat.set(140,140);
function elevation(x,z){const far=T.MathUtils.smoothstep(Math.hypot(x,z),65,240);return Math.sin(x*.047)*1.4+Math.cos(z*.041)*1.2+Math.sin((x+z)*.09)*.28+far*(Math.sin(x*.011)*Math.cos(z*.012)*13+Math.sin(z*.023+x*.015)*4)}
function biomeAt(x,z){return z < -140?'frost':z>160&&x<40?'wetland':x>28?'canyon':'meadow'}
const landG=new T.PlaneGeometry(1060,1060,190,190);landG.rotateX(-Math.PI/2);const pos=landG.attributes.position,cols=[];for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,elevation(x,z));const c=new T.Color().lerpColors(new T.Color(0xb6d3a3),new T.Color(0xe3b3a9),T.MathUtils.smoothstep(x,15,40));if(z< -140)c.lerp(new T.Color(0xd4e4e5),T.MathUtils.smoothstep(-z,140,220));if(z>160&&x<40)c.lerp(new T.Color(0x789f91),.65);for(const n of folks){const length=n.x*n.x+n.z*n.z,tt=Math.max(0,Math.min(1,(x*n.x+z*n.z)/length)),dd=Math.hypot(x-n.x*tt,z-n.z*tt);if(dd<2.2)c.lerp(new T.Color(0xbead92),.75)}cols.push(c.r,c.g,c.b)}landG.setAttribute('color',new T.Float32BufferAttribute(cols,3));landG.computeVertexNormals();mesh(landG,new T.MeshStandardMaterial({map:groundTex,vertexColors:true,roughness:1}));
const moon=ball(scene,65,20,-130,15,0xeee4cf);moon.material=new T.MeshBasicMaterial({color:0xe5ded2});const ring=mesh(new T.TorusGeometry(22,.7,8,64),mat(0xd9a8a5),65,20,-130);ring.rotation.x=1.15;ring.rotation.z=-.4;
let worldSeed=42815;function worldRandom(){worldSeed=(Math.imul(worldSeed,1664525)+1013904223)>>>0;return worldSeed/4294967296}
// Distant canyon walls, small ferns and low rock outcrops. No fake mushroom trees.
for(let i=0;i<65;i++){let a=i/65*Math.PI*2,r=510+Math.random()*25,x=Math.cos(a)*r,z=Math.sin(a)*r;const rock=mesh(new T.ConeGeometry(18+Math.random()*30,45+Math.random()*95,5),mat(x>20?0xcaa5ae:0x8ca798),x,4,z);rock.rotation.y=Math.random()*7;rock.castShadow=false}
for(let i=0;i<1300;i++){
 const x=worldRandom()*980-490,z=worldRandom()*980-490;
 if(folks.some(n=>Math.hypot(n.x-x,n.z-z)<9)||Math.hypot(x,z-17)<6)continue;
 const y=elevation(x,z);
 if(x>28){const c=mesh(coneG,mat(i%2?0xc4c4e6:0x95d3d3,.28),x,y+.3,z);c.scale.set(.24+worldRandom()*.2,.45+worldRandom()*.85,.28);c.rotation.z=(worldRandom()-.5)*.45}
 else{const g=new T.Group();scene.add(g);g.position.set(x,y,z);for(let j=0;j<5;j++){const a=j*1.26,leaf=ball(g,Math.cos(a)*.16,.16,Math.sin(a)*.16,1,i%2?0x769b7a:0x8bb78c);leaf.geometry=leafG;leaf.scale.set(.07,.035,.3);leaf.rotation.set(.3,a,0)}if(i%3===0){const stone=ball(g,.3,.13,-.1,1,0x99aa94);stone.geometry=stoneG;stone.scale.set(.23,.13,.2)}}
}
// Natural landmarks: basalt outcrops, marsh pools and ice shelves.
for(let i=0;i<38;i++){
 const x=60+worldRandom()*390,z=worldRandom()*880-440;
 if(folks.some(n=>Math.hypot(x-n.x,z-n.z)<16))continue;
 let road=false;for(const n of folks){const l=n.x*n.x+n.z*n.z,f=T.MathUtils.clamp((x*n.x+z*n.z)/l,0,1);if(Math.hypot(x-n.x*f,z-n.z*f)<8)road=true}if(road)continue;
 const r=2+worldRandom()*3,h=3+worldRandom()*7;
 const o=mesh(new T.DodecahedronGeometry(1,0),mat(z< -140?0xb8c8cd:0xa18c7b),x,elevation(x,z)+h*.3,z);o.scale.set(r,h,r*.7);o.rotation.y=worldRandom()*6.28;solidObjects.push({x,z,r:r*.8,h:h*1.3});
}
for(let i=0;i<12;i++){const x=-65-worldRandom()*340,z=190+worldRandom()*235;const water=mesh(new T.CircleGeometry(4+worldRandom()*4,36),new T.MeshStandardMaterial({color:0x557f85,metalness:.25,roughness:.28}),x,elevation(x,z)+.12,z);water.rotation.x=-Math.PI/2;water.scale.x=1.4;water.castShadow=false}
const rover=new T.Group();rover.scale.setScalar(.82);scene.add(rover);box(rover,0,1,0,3.3,.55,5.4,0x354d4c);box(rover,0,2.05,.15,3.1,1.8,4.7,0x4e958b);box(rover,0,3.12,.2,3.2,.48,4.8,0xf6dec0);box(rover,0,2.6,-2,2.95,.95,.8,0xf5ddbd);box(rover,0,2.68,-2.43,2.5,.63,.055,0x394f59);box(rover,0,1.75,-2.62,2.8,.55,.17,0xefd9b8);box(rover,0,1.03,-2.83,3.35,.25,.35,0x718080);for(const x of [-1.02,1.02]){box(rover,x,1.85,-2.73,.5,.28,.04,0xffe5a1);box(rover,x,3.53,1,.5,.3,1.5,0x71806b)}
const wheels=[];for(const x of [-1.63,1.63])for(const z of [-1.68,0,1.68]){const wheel=cylinder(rover,x,.77,z,.75,.43,0x364347);wheel.rotation.z=Math.PI/2;wheels.push(wheel);const hub=cylinder(rover,x*1.14,.77,z,.4,.08,0xddc6a1);hub.rotation.z=Math.PI/2;for(let n=0;n<10;n++){const tread=box(rover,x,.77+Math.cos(n*.628)*.72,z+Math.sin(n*.628)*.72,.48,.12,.2,0x465451);tread.rotation.x=-n*.628}}
box(rover,1.58,2.35,.45,.06,.9,2.3,0x233f43);box(rover,1.92,1.91,.45,.8,.12,2.55,0xf4d5a9);for(let i=0;i<7;i++){const aw=box(rover,1.94,3.08,-.73+i*.37,.9,.1,.37,i%2?0xf4dfbd:0xca775c);aw.rotation.z=-.15}box(rover,0,3.45,-.4,2.2,.1,1.65,0x344b60);for(let i=0;i<5;i++)box(rover,-.88+i*.44,3.515,-.4,.02,.012,1.58,0x82adb0);
const sign=label(tr('КОСМОКУХНЯ','COSMIC KITCHEN'),rover,0,3.72,.95,2.45);sign.rotation.y=0;
const engineGlow=box(rover,0,1.6,2.62,1.7,.35,.06,0xe0a667);
// A human-sized explorer, separate from the parked truck.
const chef=makeChef();scene.add(chef);const {legs,arms}=chef.userData;
const nodeList=[];
function makeNode(kind,x,z){
 if(solidObjects.some(o=>Math.hypot(o.x-x,o.z-z)<o.r+2))return;
 const g=new T.Group();scene.add(g);g.position.set(x,elevation(x,z),z);
 const item=new T.Group();g.add(item);const bubbles=[];
 if(kind==='berry'){
  // A leafy bush below waist height, with small clustered berries.
  for(let j=0;j<6;j++){const a=j*1.047,stem=cylinder(item,Math.cos(a)*.13,.24,Math.sin(a)*.13,.022,.46,0x527655);stem.rotation.z=Math.sin(a)*.35;
   const leaf=ball(item,Math.cos(a)*.29,.29+(j%2)*.15,Math.sin(a)*.29,1,j%2?0x709b68:0x4e8266);leaf.geometry=leafG;leaf.scale.set(.15,.055,.29);leaf.rotation.set(-.25,a,.25);
   for(let k=0;k<3;k++){const berry=ball(item,Math.cos(a)*.3+(k-1)*.075,.48+(j%2)*.13+(k%2)*.1,Math.sin(a)*.3,.072,k%2?0xe5a2c0:0xbb5c95);ball(item,berry.position.x,berry.position.y+.063,berry.position.z,.023,0x77945d)}
  }
 }else if(kind==='mushroom'){
  for(let j=0;j<4;j++){const a=j*2.4,r=.25,h=.23+(j%3)*.065,px=Math.cos(a)*r,pz=Math.sin(a)*r;
   cylinder(item,px,h*.5,pz,.055,h,0xf7dfb9);
   const cap=ball(item,px,h,pz,1,j%2?0xd49761:0xe2b967);cap.scale.set(.18+(j%2)*.045,.10,.18+(j%2)*.045);
   for(let k=0;k<3;k++)ball(item,px+Math.cos(k*2)*.09,h+.078,pz+Math.sin(k*2)*.09,.024,0xffedbd);
  }
 }else if(kind==='soda'){
  // Mineral water is a turquoise bubbling spring, not an ambiguous crystal.
  cylinder(g,0,.045,0,.83,.09,0xa6ada2);
  for(let j=0;j<8;j++){const a=j*Math.PI/4,rock=ball(g,Math.cos(a)*.7,.13,Math.sin(a)*.7,1,0xbcc4b4);rock.scale.set(.2,.12,.18)}
  const water=cylinder(item,0,.10,0,.59,.045,0x4bbccc);water.material=new T.MeshStandardMaterial({color:0x45bccb,emissive:0x247580,emissiveIntensity:.3,roughness:.18});
  for(let j=0;j<2;j++){const r=mesh(new T.TorusGeometry(.23+j*.2,.013,5,28),mat(0xbcf0e8),0,.132,0,item);r.rotation.x=Math.PI/2}
  for(let j=0;j<4;j++){const bubble=ball(item,Math.cos(j*2)*.26,.16,Math.sin(j*2)*.26,.045,0xc6f6ee);bubbles.push(bubble)}
  cylinder(item,.84,.23,.18,.105,.43,0x88d6d0);cylinder(item,.84,.49,.18,.058,.12,0xb1e4d7);cylinder(item,.84,.57,.18,.069,.05,0x376f85);box(item,.84,.28,.078,.15,.16,.015,0xf4eccc);
 }
 if(!['berry','mushroom','soda'].includes(kind)){
  if(kind==='egg'){const nest=cylinder(item,0,.035,0,.38,.07,0x9b7654);for(let j=0;j<3;j++){const egg=ball(item,(j-1)*.19,.16,Math.sin(j*2)*.09,1,0xe9dfbe);egg.scale.set(.09,.14,.09)}}
  else if(kind==='salt'){for(let j=0;j<5;j++){const crystal=mesh(new T.OctahedronGeometry(.14),mat(0xd9e4e8,.18),Math.cos(j*2)*.22,.14,Math.sin(j*2)*.22,item);crystal.scale.y=1.5}}
  else if(kind==='grain'){for(let j=0;j<7;j++){const x=Math.cos(j*2.4)*.23,z=Math.sin(j*2.4)*.23,h=.46+(j%3)*.09;cylinder(item,x,h/2,z,.012,h,0xa18f51);for(let k=0;k<4;k++){const ear=ball(item,x+(k%2?.035:-.035),h-.12+k*.05,z,.045,0xd6bd75);ear.scale.set(.7,1.4,.7)}}}
  else if(kind==='algae'){cylinder(item,0,.03,0,.52,.05,0x699f9f);for(let j=0;j<6;j++){const leaf=ball(item,Math.cos(j)*.23,.23,Math.sin(j)*.23,1,0x438f8c);leaf.geometry=leafG;leaf.scale.set(.035,.28,.11);leaf.rotation.z=Math.sin(j)*.5}}
  else {for(let j=0;j<5;j++){const a=j*1.256,x=Math.cos(a)*.23,z=Math.sin(a)*.23;const leaf=ball(item,x,.18,z,1,kind==='herb'?0x678c51:0x64825d);leaf.geometry=leafG;leaf.scale.set(.09,.04,.23);leaf.rotation.set(-.3,a,0);if(kind==='herb'){cylinder(item,x,.28,z,.013,.5,0x567149);for(let k=0;k<3;k++){const l=ball(item,x,.24+k*.09,z,.095,0x7ba366);l.scale.y=.35}}else if(kind==='root'){const root=mesh(coneG,mat(colors.root),x,.12,z,item);root.scale.set(.09,.36,.09);root.rotation.z=Math.PI}else if(kind==='spice'){const pod=ball(item,x,.32,z,1,colors.spice);pod.scale.set(.055,.18,.06);pod.rotation.z=a*.2}else if(kind==='milk'){const bulb=ball(item,x,.31,z,1,0xf3e8cb);bulb.scale.set(.12,.17,.12);ball(item,x,.47,z,.045,0xa8b899)}else{cylinder(item,x,.24,z,.014,.45,0x58734e);ball(item,x,.44,z,.11,colors[kind]);ball(item,x,.54,z,.04,0x66824a)}}}
 }
 const halo=mesh(new T.TorusGeometry(kind==='soda'?.97:.69,.018,6,28),new T.MeshBasicMaterial({color:colors[kind]}),0,.035,0,g);halo.rotation.x=Math.PI/2;
 const markerTex=texture((c,w,h)=>{c.fillStyle=kind==='soda'?'#285f69':'#345747';c.beginPath();c.roundRect(0,0,w,h,16);c.fill();c.fillStyle='#faf4dd';c.textAlign='center';c.textBaseline='middle';c.font='bold 30px Arial, sans-serif';c.fillText(kind==='soda'?tr('МИНЕРАЛКА','MINERAL WATER'):words[kind],w/2,h/2,w-20)},384,64);
 const marker=new T.Sprite(new T.SpriteMaterial({map:markerTex,depthTest:false}));marker.position.set(0,kind==='soda'?1.25:1.1,0);marker.scale.set(1.9,.32,1);marker.renderOrder=2;g.add(marker);
 nodeList.push({kind,x,z,g,item,halo,marker,bubbles,ready:0,phase:worldRandom()*6});
}
// Guaranteed starting ingredients and several fixed, reachable water sources.
[['berry',5,10],['mushroom',-5,6],['mushroom',-9,0],['berry',-27,-8],['soda',12,7],['soda',35,-2],['soda',48,-14],['soda',63,-25]].forEach(a=>makeNode(...a));
// Reachable introductory samples; most ingredients also have biome-specific patches.
[['tomato',-12,18],['root',-20,8],['herb',-8,22],['grain',-26,-24],['milk',-38,-42],['egg',68,-27],['salt',45,-37],['spice',75,-12],['algae',-30,58]].forEach(a=>makeNode(...a));
for(let i=0;i<320;i++){
 const kind=Object.keys(words)[i%12];let x=worldRandom()*920-460,z=worldRandom()*920-460;
 if(['soda','salt','spice'].includes(kind))x=35+worldRandom()*430;
 if(kind==='algae'){x=-420+worldRandom()*430;z=175+worldRandom()*270}
 if(kind==='milk'||kind==='egg')z=-170-worldRandom()*260;
 if(!folks.some(n=>Math.hypot(x-n.x,z-n.z)<10)&&!nodeList.some(n=>Math.hypot(x-n.x,z-n.z)<3))makeNode(kind,x,z)
}
// Replace the old three-dome placeholders; retain resource layout and save IDs.
solidObjects.splice(0,folks.length*3);
const environment=populateAurelia({scene,elevation,biomeAt,folks,nodes:nodeList,solids:solidObjects,label,tr});
const aliens=[];for(const n of folks){const anchor=new T.Group();anchor.position.set(n.x,elevation(n.x,n.z),n.z);environment.towns[n.id].add(anchor);const a=makeResident(n.species,n.id);a.position.set(0,0,2);anchor.add(a);aliens.push(a);}
// Cutaway 3D kitchen, four independently selectable workstations.
const woodTex=texture((g,w,h)=>{g.fillStyle='#bb885d';g.fillRect(0,0,w,h);for(let y=0;y<h;y+=32){g.fillStyle=y%64?'#9f704855':'#e0b88644';g.fillRect(0,y,w,30);g.strokeStyle='#69483255';g.strokeRect(0,y,w,32);for(let j=0;j<8;j++){g.beginPath();g.moveTo(0,y+j*4);g.bezierCurveTo(60,y+8+j*2,150,y-4+j*5,256,y+j*4);g.stroke()}}});woodTex.wrapS=woodTex.wrapT=T.RepeatWrapping;woodTex.repeat.set(3,2);
const rearShell=new T.Group();kitchen.add(rearShell);
const floor=box(kitchen,0,-.12,0,10,.3,9,0xbaa586);floor.material=new T.MeshStandardMaterial({map:woodTex});box(rearShell,0,2.2,-4.25,10,4.6,.2,0xf0d9b4);box(rearShell,-5,2.2,-1.7,.2,4.6,5.3,0xc4cdb2);box(rearShell,0,.8,-4.08,9.9,1.6,.08,0x6c9989);
for(let x=-4.5;x<5;x+=.5)box(rearShell,x,.8,-4.01,.018,1.5,.02,0x365f5544);
box(kitchen,0,1.07,-2.65,9.3,2.1,2,0x608e80);box(kitchen,0,2.19,-2.55,9.6,.2,2.25,0xf4e1bd);for(let x=-4;x<=4;x+=2){box(kitchen,x,1.1,-1.62,1.7,1.6,.06,0x84a78f);box(kitchen,x,1.5,-1.55,.55,.07,.06,0xdfc6a1)}
const windowPic=texture((g,w,h)=>{const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'#babfe0');gr.addColorStop(1,'#e7d4b5');g.fillStyle=gr;g.fillRect(0,0,w,h);g.fillStyle='#849f8d';g.beginPath();g.moveTo(0,h);for(let x=0;x<=w;x+=10)g.lineTo(x,h*.65+Math.sin(x*.024)*18);g.lineTo(w,h);g.fill();g.fillStyle='#fff0c7';g.beginPath();g.arc(190,48,24,0,7);g.fill()},256,160);mesh(new T.PlaneGeometry(3.8,1.9),new T.MeshBasicMaterial({map:windowPic}),.5,3.15,-4.10,kitchen);box(kitchen,.5,4.13,-4,4,.12,.17,0x748f77);box(kitchen,.5,2.17,-4,4,.12,.17,0x748f77);for(const x of [-1.5,.5,2.5])box(kitchen,x,3.15,-4,.1,2,.15,0x748f77);
box(kitchen,-3.25,3.55,-3.96,2.55,.14,.55,0xa78462);for(let i=0;i<5;i++){cylinder(kitchen,-4.2+i*.47,3.85,-3.8,.16,.43,[0xadc7a1,0xe7be93,0xb6c8cf][i%3]);cylinder(kitchen,-4.2+i*.47,4.1,-3.8,.17,.07,0x61796a)}
for(let i=0;i<9;i++){const x=-4.4+i*1.08;const b=ball(kitchen,x,4.55-Math.cos(i/8*Math.PI*2)*.15,-2.8,.085,0xffd891);b.material=new T.MeshBasicMaterial({color:0xffdc97})}
label('A LITTLE TASTE OF THE COSMOS',kitchen,-2.8,2.85,-4.05,3);
const stationX={chop:-3.3,fry:-1.1,mix:1.1,bake:3.3,wash:-3.3,blend:-1.1,boil:1.1,season:3.3},stationZ={chop:-2.2,fry:-2.2,mix:-2.2,bake:-2.2,wash:1.2,blend:1.2,boil:1.2,season:1.2}, stationHits=[];for(const key of Object.keys(stationX)){const o=box(kitchen,stationX[key],2.35,stationZ[key],1.85,.15,1.7,0xf3e3c7);o.userData.station=key;stationHits.push(o)}
const board=box(kitchen,-3.3,2.48,-2.2,1.6,.1,1.3,0xb78a5b);const knife=new T.Group();kitchen.add(knife);knife.position.set(-3.3,2.95,-2.15);box(knife,0,0,0,.08,.33,.9,0xcddad5);box(knife,0,.1,.65,.15,.18,.5,0x4d695f);
const hob=box(kitchen,-1.1,2.52,-2.2,1.7,.12,1.55,0x394e4e);const pan=cylinder(kitchen,-1.1,2.65,-2.2,.7,.16,0x434d4f);box(kitchen,-1.1,2.68,-1.22,.13,.12,.73,0xa47953);const flame=mesh(new T.TorusGeometry(.52,.055,6,28),new T.MeshBasicMaterial({color:0xe69556}),-1.1,2.58,-2.2,kitchen);flame.rotation.x=Math.PI/2;
const bowl=mesh(new T.SphereGeometry(.68,24,14,0,Math.PI*2,Math.PI/2,Math.PI/2),new T.MeshStandardMaterial({color:0xa9cacc,side:T.DoubleSide}),1.1,3.12,-2.2,kitchen);const spoon=new T.Group();kitchen.add(spoon);spoon.position.set(1.1,2.85,-2.2);const sp=box(spoon,0,.4,0,.06,.8,.06,0xbc905f);sp.rotation.z=.4;ball(spoon,0,0,0,.12,0xc29d70);
box(kitchen,3.3,2.98,-2.4,1.7,1.16,1.55,0x4d6365);box(kitchen,3.3,3.64,-2.3,1.85,.16,1.75,0xefcfaa);box(kitchen,3.3,2.85,-1.6,1.4,.75,.03,0x2f4145);const ovenDoor=new T.Group();ovenDoor.position.set(3.3,2.52,-1.55);kitchen.add(ovenDoor);box(ovenDoor,0,.35,0,1.45,.7,.08,0x638f8c);box(ovenDoor,0,.34,.055,1.1,.4,.02,0x2e474b);box(ovenDoor,0,.59,.13,.8,.065,.1,0xe4c99f);const ovenLight=ball(kitchen,3.8,3.64,-1.41,.055,0xe5b971);
// Functional island: running-water sink, blender, stockpot and seasoning rack.
box(kitchen,0,1.08,1.2,9.4,2.12,1.85,0x52796c);const island=box(kitchen,0,2.2,1.2,9.65,.2,2,0xb4b7aa);island.material=new T.MeshStandardMaterial({color:0xaaa99c,metalness:.45,roughness:.34});
box(kitchen,-3.3,2.43,1.2,1.35,.18,1.15,0x798f91);box(kitchen,-3.3,2.54,1.2,1.12,.05,.9,0x416f75);
const faucet=mesh(new T.TorusGeometry(.28,.04,8,24,Math.PI),mat(0xb9c8c5,.25),-3.3,2.98,.7,kitchen);cylinder(kitchen,-3.58,2.72,.7,.04,.52,0xb9c8c5);
const tapWater=cylinder(kitchen,-3.02,2.74,.7,.022,.42,0xa8d8dd);tapWater.visible=false;
cylinder(kitchen,-1.1,2.53,1.2,.43,.24,0x597d79);const blender=cylinder(kitchen,-1.1,3.02,1.2,.3,.75,0xbad7d1);blender.material=new T.MeshStandardMaterial({color:0xcde4df,transparent:true,opacity:.42,roughness:.17});cylinder(kitchen,-1.1,3.43,1.2,.34,.09,0x688c80);
box(kitchen,1.1,2.43,1.2,1.5,.1,1.4,0x35494b);const potRing=mesh(new T.TorusGeometry(.6,.035,6,32),new T.MeshBasicMaterial({color:0xe69c57}),1.1,2.52,1.2,kitchen);potRing.rotation.x=Math.PI/2;potRing.visible=false;const pot=cylinder(kitchen,1.1,2.78,1.2,.58,.53,0x839797);pot.material=new T.MeshStandardMaterial({color:0x9caead,metalness:.7,roughness:.3});cylinder(kitchen,1.1,3.055,1.2,.52,.02,0xc5ab78);for(const x of [.36,1.84])box(kitchen,x,2.86,1.2,.36,.09,.12,0x58716d);
for(let j=0;j<5;j++){cylinder(kitchen,2.85+(j%3)*.38,2.63,.85+Math.floor(j/3)*.42,.115,.43,[0xa85f42,0xa3ab79,0xd8d3ad,0x828f58,0xbb9c66][j]);cylinder(kitchen,2.85+(j%3)*.38,2.87,.85+Math.floor(j/3)*.42,.12,.06,0x48675e)}
box(kitchen,4.35,1.17,3.0,1.2,2.35,1.05,0xc3cdc3);box(kitchen,4.35,2.65,3.0,1.2,.55,1.05,0x738c7b);box(kitchen,4.05,1.32,3.56,.06,.72,.08,0x687e78);label(tr('ХОЛОДИЛЬНИК','FRIDGE'),kitchen,4.35,2.0,3.535,1.05);
for(let j=0;j<6;j++){const plate=cylinder(kitchen,3.1,3.85+j*.06,-3.85,.28,.04,0xe6dfc9)}
box(kitchen,-4.5,3.0,-3.9,.18,1.15,.06,0xad855e);for(let j=0;j<4;j++){cylinder(kitchen,-4.5+j*.22,3.0,-3.8,.035,.5,0x889c97)}
const steamTexture=texture((c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'#eef0df77');g.addColorStop(1,'#eef0df00');c.fillStyle=g;c.fillRect(0,0,w,h)},64,64);
const steam=[];for(let j=0;j<7;j++){const a=new T.Sprite(new T.SpriteMaterial({map:steamTexture,transparent:true,depthWrite:false,opacity:.25}));kitchen.add(a);steam.push(a)}
for(const color of [0x434d4f,0xcddad5,0x4d6365]){mat(color).metalness=.65;mat(color).roughness=.34}
const foodBits=[];for(let i=0;i<9;i++){const o=ball(kitchen,0,0,0,.1,i%2?colors.berry:colors.mushroom);foodBits.push({o,v:new T.Vector3(),base:new T.Vector3(),rest:2.66})}
// Finished dishes are visible 3D objects, not just a completion message.
const plated=[];
for(let id=0;id<recipes.length;id++){
 const g=new T.Group();g.position.set(-3.3,2.6,-2.2);kitchen.add(g);plated.push(g);
 cylinder(g,0,.035,0,.66,.07,0xf5e5c5);
 if(recipes[id].type==='drink'){const glass=cylinder(g,0,.43,0,.27,.72,0xc0e4da);glass.material=new T.MeshStandardMaterial({color:0xd6efeb,transparent:true,opacity:.45,roughness:.12});cylinder(g,0,.36,0,.23,.55,0x98cfc1);cylinder(g,.13,.93,0,.023,.7,0xe8b391);ball(g,-.12,.79,0,.12,colors.berry)}
 else if(recipes[id].type==='pie'){cylinder(g,0,.18,0,.52,.26,0xd9a063);cylinder(g,0,.32,0,.47,.04,id===2?0xbd708b:0xb9c17e);for(let i=0;i<4;i++)box(g,(i-1.5)*.2,.36,0,.06,.045,.8,0xebbd83)}
 else {for(let i=0;i<7;i++){const x=Math.cos(i*2.4)*.34,z=Math.sin(i*2.4)*.34;const bite=ball(g,x,.15,z,.16,i%2?0xe0ba70:0x93ad7d);bite.scale.y=.5;}for(let i=0;i<3;i++)ball(g,Math.cos(i*2)*.25,.22,Math.sin(i*2)*.25,.095,colors.berry)}
}
function arrangeFood(){plated.forEach((g,id)=>g.visible=S.dish===id);const stage=S.cook?cookingRecipe().steps[S.cook.step]:'chop';for(let i=0;i<foodBits.length;i++){const f=foodBits[i];f.base.set(stationX[stage]+(i%3-1)*.24,stage==='bake'?2.76:stage==='boil'?3.12:2.65,stationZ[stage]+(Math.floor(i/3)-1)*.22);f.o.position.copy(f.base);f.v.set(0,0,0);f.rest=f.base.y;f.o.visible=!!S.cook}}
function impulse(force){for(const f of foodBits){f.v.x+=(Math.random()-.5)*.4;f.v.z+=(Math.random()-.5)*.4;f.v.y=force*(.7+Math.random()*.3)}}
const lowGravity=()=>biomeAt(view==='kitchen'?S.truck.x:S.x,view==='kitchen'?S.truck.z:S.z)==='canyon';const stableGravity=()=>!lowGravity()||S.completed>=4;
function selectStation(key){selected=key;document.querySelectorAll('[data-station]').forEach(b=>b.classList.toggle('on',b.dataset.station===key));updateUI()}
function truckDistance(){return Math.hypot(S.x-S.truck.x,S.z-S.truck.z)}
function toggleVehicle(){
 if(mode!=='playing'||view!=='drive')return;
 if(!S.riding&&truckDistance()>3.5){trackedKind='truck';toast(tr('Подойди к вездеходу. Он отмечен на карте.','Walk to the truck. It is marked on the map.'));updateUI();return}
 clearInput();speed=0;orbit=0;
 if(S.riding){
  S.riding=false;const h=S.truck.heading,c=Math.cos(h),sn=Math.sin(h);
  const exits=[[c*2.6,sn*2.6],[-c*2.6,-sn*2.6],[sn*3.3,-c*3.3],[-sn*3.3,c*3.3]];
  const exit=exits.find(([dx,dz])=>Math.abs(S.truck.x+dx)<=WORLD&&Math.abs(S.truck.z+dz)<=WORLD)||[0,-3.3];
  S.x=T.MathUtils.clamp(S.truck.x+exit[0],-WORLD,WORLD);S.z=T.MathUtils.clamp(S.truck.z+exit[1],-WORLD,WORLD);S.heading=h;footYaw=h;
 }else{S.riding=true;S.x=S.truck.x;S.z=S.truck.z;S.heading=S.truck.heading;}
 findNearest();save();updateUI();
}
function switchView(){
 openSheet('');
 if(mode!=='playing')return;
 if(view==='drive'&&!S.riding){trackedKind='truck';toast(tr('Сначала сядь в машину: F или кнопка «В машину». Потом K — кухня.','Get in with F or the vehicle button first. Then K opens the kitchen.'));updateUI();return}
 clearInput();speed=0;view=view==='drive'?'kitchen':'drive';document.body.dataset.view=view;
 if(view==='kitchen'){selectStation(S.cook?cookingRecipe().steps[S.cook.step]:'chop');arrangeFood()}
 findNearest();save();updateUI();
}
function trackedTarget(){
 if(trackedKind?.startsWith('npc:')){const n=folks[Number(trackedKind.split(':')[1])];return {...n,z:n.z+2,kind:'npc'}}
 if(trackedKind==='truck')return {...S.truck,kind:'truck'};
 let kind=trackedKind;
 if(!kind&&S.active&&S.dish===null&&!S.cook){const r=recipes[S.active.recipe];kind=Object.keys(r.need).find(k=>S.inventory[k]<r.need[k]);}
 if(!kind){if(S.dish!==null&&S.active){const n=folks[S.active.npc];return {...n,z:n.z+2,kind:'npc'}}if(S.active)return {...S.truck,kind:'truck'};const n=[...folks].sort((a,b)=>Math.hypot(S.x-a.x,S.z-a.z)-Math.hypot(S.x-b.x,S.z-b.z))[0];return {...n,z:n.z+2,kind:'npc'}}
 return nodeList.filter(n=>n.kind===kind&&t>=n.ready).sort((a,b)=>Math.hypot(a.x-S.x,a.z-S.z)-Math.hypot(b.x-S.x,b.z-S.z))[0]||null;
}
function enough(){return S.active&&Object.entries(cookingRecipe().need).every(([k,n])=>S.inventory[k]>=n)}
function fault(reason){if(S.cook)S.cook.errors??=[];if(S.cook&&!S.cook.errors.includes(reason))S.cook.errors.push(reason)}
function beginCook(){
 if(mode!=='playing'||view!=='kitchen'||!S.riding)return;
 if(!S.active){toast(tr('Сначала возьми заказ.','Take an order first.'));return}
 if(S.dish!==null||S.cook||!enough())return;
 trackedKind=null;const r=cookingRecipe();for(const [k,n]of Object.entries(r.need))S.inventory[k]-=n;
 S.cook={recipe:r.id,errors:[],step:0,chops:0,mix:0,heat:0,hot:0,oven:0,door:0,season:0};selectStation(r.steps[0]);arrangeFood();save();updateUI();beep();
}
function advance(){
 workHeld=false;flame.visible=false;potRing.visible=false;const r=cookingRecipe();S.cook.step++;
 if(S.cook.step>=r.steps.length){trackedKind=null;S.dish=r.id;S.dishFaults=[...S.cook.errors];S.cook=null;selected='chop';toast(S.dishFaults.length?tr('Блюдо с ошибками. За него заказчик удержит 1 монету.','Dish has faults. The customer will charge 1 coin.'):tr('Блюдо упаковано. Проверь, что заказчик просил именно его.','Dish packed. Make sure it matches the customer’s order.'));beep(900)}
 else{Object.assign(S.cook,{chops:0,mix:0,heat:0,hot:0,oven:0,door:0,season:0});selectStation(r.steps[S.cook.step])}
 arrangeFood();save();updateUI();
}
function work(){
 if(mode!=='playing'||view!=='kitchen'||!S.riding)return;
 if(!S.cook){beginCook();return}
 const stage=cookingRecipe().steps[S.cook.step];if(selected!==stage){toast(tr('Нужная станция: ','Use: ')+stageNames[stage]);return}
 if(stage==='chop'){S.cook.chops++;knifeKick=1;impulse(.9);beep(470);if(S.cook.chops>=5)advance()}
 else if(['wash','mix','blend'].includes(stage)){S.cook.mix++;stir+=1.2;impulse(stableGravity()?.6:1.4);beep(610);const goal=stage==='wash'?3:stage==='blend'?6:8;if(S.cook.mix>=goal)advance()}
 else if(stage==='season'){S.cook.season++;beep(560)}
 else if(stage==='bake'){if(S.cook.door===0)S.cook.door=1;else if(S.cook.door===1)S.cook.door=2;else{if(S.cook.oven<6)fault(tr('сырая выпечка','raw bake'));if(S.cook.oven>10)fault(tr('сгоревшая выпечка','burnt bake'));advance()}}
 save();updateUI();
}
function finishFry(){
 if(mode!=='playing'||view!=='kitchen'||!S.cook)return;const stage=cookingRecipe().steps[S.cook.step];if(stage!==selected)return;
 if(stage==='season'){if(S.cook.season!==(cookingRecipe().season||1))fault(tr('неверная дозировка специй','wrong seasoning amount'));advance()}
 else if(['fry','boil'].includes(stage)){if(S.cook.heat<.55)fault(tr('недоготовлено','undercooked'));if(S.cook.heat>.84)fault(tr('перегрето','overheated'));advance();beep(870)}
}
function recipeFor(n){return n.menu[S.completed%n.menu.length]}
function interact(){
 if(mode!=='playing'||view!=='drive'||S.riding)return;findNearest();if(!nearest)return;const n=nearest;
 if(n.kind==='resource'){if(S.inventory[n.node.kind]>=99){toast(tr('Отсек заполнен.','Storage is full.'));return}S.inventory[n.node.kind]++;n.node.ready=t+24;n.node.item.visible=false;beep(830);toast('+1 · '+words[n.node.kind]);save();findNearest();updateUI();return}
 if(n.kind==='local'){toast(n.npc.name+': '+n.npc.text);return}
 const npc=n.npc;
 if(S.active){
  if(S.active.npc!==npc.id){toast(npc.name+': '+npc.taste+' '+tr('Сначала доставь текущий заказ.','Deliver your current order first.'));return}
  if(S.dish!==null){
   const correct=S.dish===S.active.recipe&&S.dishFaults.length===0,price=recipes[S.active.recipe].price;
   S.dish=null;S.dishFaults=[];S.cook=null;
   if(correct){S.completed++;S.earned+=price;S.active=null;save();send('addCoins',price);beep(1100);toast(npc.name+': '+tr('Именно то, что я хотел! +','Exactly what I wanted! +')+price+tr(' монет.',' coins.')+(S.completed===2?tr(' Турбоколёса установлены.',' Turbo wheels installed.'):S.completed===4?tr(' Магнитная столешница установлена.',' Magnetic worktop installed.'):''));}
   else{S.failures++;S.earned=Math.max(0,S.earned-1);save();send('roverPenalty',1);beep(180);toast(npc.name+': '+tr('Это не мой заказ или блюдо испорчено. Компенсация −1 монета. Жду новое блюдо.','Wrong order or spoiled dish. Compensation: −1 coin. Please make it again.'))}
   engineGlow.material=mat(S.completed>=2?0x9ae0d0:0xe0a667);arrangeFood();
  }else toast(npc.name+': '+npc.taste+' '+tr('Жду: ','Waiting for: ')+recipes[S.active.recipe].name)
 }else{S.active={npc:npc.id,recipe:recipeFor(npc)};chosenRecipe=S.active.recipe;toast(npc.name+': '+npc.taste);save()}
 updateUI();
}
function findNearest(){
 nearest=null;
 if(S.riding)return
 let distance=2.35;
 for(const node of nodeList)if(t>=node.ready){const d=Math.hypot(S.x-node.x,S.z-node.z);if(d<distance){distance=d;nearest={kind:'resource',node}}}
 for(const npc of folks){const d=Math.hypot(S.x-npc.x,S.z-(npc.z+2));if(d<distance){distance=d;nearest={kind:'npc',npc}}}
 for(const local of environment.locals){const d=Math.hypot(S.x-local.x,S.z-local.z);if(d<distance){distance=d;nearest={kind:'local',npc:local}}}
}
function updateUI(){
 const r=S.active?recipes[S.active.recipe]:null,cr=cookingRecipe(),npc=S.active?folks[S.active.npc]:null;
 $('worldNav').classList.toggle('active',view==='drive'&&!document.body.dataset.sheet);$('switch').classList.toggle('active',view==='kitchen'&&!document.body.dataset.sheet);
 const biome=biomeAt(S.x,S.z);$('biome').textContent={meadow:tr('ЛУГА АУРЕЛИИ','AURELIA MEADOWS'),canyon:tr('КРИСТАЛЬНЫЙ КАНЬОН','CRYSTAL CANYON'),wetland:tr('ЛАЗУРНЫЕ БОЛОТА','AZURE WETLANDS'),frost:tr('СЕВЕРНОЕ НАГОРЬЕ','NORTHERN HIGHLANDS')}[biome];
 $('gravity').textContent=lowGravity()?'0.18 G':'0.9 G';$('balance').textContent=S.earned;$('deliveries').textContent=S.completed;
 $('switchLabel').textContent=view==='drive'?tr('Кухня','Kitchen'):tr('За руль','Drive');
 $('switch').disabled=view==='drive'&&!S.riding;$('switch').title=S.riding?tr('Открыть кухню','Open kitchen'):tr('Сначала сядь в машину на F','Get in the truck with F first');
 $('goalTitle').textContent=r?r.name:tr('Новый заказ','New order');$('orderNeeds').textContent=r?Object.entries(r.need).map(([k,n])=>words[k]+' '+S.inventory[k]+'/'+n).join(' · '):tr('Поговори с жителем, чтобы взять заказ.','Talk to a resident to take an order.');$('travelLabel').textContent=S.riding?tr('ВЕЗДЕХОД','ROVER'):tr('ПЕШКОМ','ON FOOT');$('stationPicker').value=selected;
 $('orderName').textContent=r?r.name:tr('Найди новый заказ','Find a new order');
 $('customer').textContent=npc?npc.name+' · '+species[npc.species]+' · +'+r.price+' V':tr('10 ЖИТЕЛЕЙ · 8 ВИДОВ','10 LOCALS · 8 SPECIES');
 const inventoryHTML=Object.entries(words).map(([k,w])=>'<div role="button" tabindex="0" data-resource="'+k+'" class="ingredient '+(r?.need[k]?'required ':'')+(r&&S.inventory[k]>=(r.need[k]||0)?'enough':'')+'"><i class="dot" style="background:#'+colors[k].toString(16).padStart(6,'0')+'"></i><span>'+w+'</span><b>'+S.inventory[k]+(r?.need[k]?' / '+r.need[k]:'')+'</b></div>').join('');if($('ingredients').innerHTML!==inventoryHTML)$('ingredients').innerHTML=inventoryHTML;
 const goal=npc||folks[S.completed%folks.length];$('route').textContent=(S.dish!==null?tr('Доставка: ','Deliver: '):tr('Заказчик: ','Customer: '))+goal.name+' · '+Math.round(Math.hypot(S.x-goal.x,S.z-goal.z))+tr(' м',' m');
 $('progressText').textContent=S.completed<2?tr('Турбоколёса','Turbo wheels')+' · '+S.completed+'/2':S.completed<4?tr('Магнитная столешница','Magnetic worktop')+' · '+(S.completed-2)+'/2':tr('Все улучшения установлены','All upgrades installed');
 $('upgradeFill').style.width=(S.completed<4?(S.completed%2)/2*100:100)+'%';
 document.body.dataset.travel=S.riding?'truck':'foot';document.body.dataset.cooking=S.cook||S.dish!==null?'active':'none';
 $('vehicle').textContent=S.riding?tr('Выйти · F','Get out · F'):truckDistance()<3.5?tr('В машину · F','Get in · F'):tr('К машине · ','Truck · ')+Math.round(truckDistance())+tr(' м',' m');
 $('movementHint').textContent=S.riding?tr('WASD — ехать · F — выйти','WASD — drive · F — exit'):tr('WASD — идти · Shift — бег','WASD — walk · Shift — run');
 $('action').hidden=S.riding||!nearest;
 $('action').disabled=!nearest;
 $('action').textContent=nearest?.kind==='resource'?tr('Собрать · E','Gather · E'):S.active?.npc===nearest?.npc?.id&&S.dish!==null?tr('Подать блюдо · E','Serve dish · E'):tr('Поговорить · E','Talk · E');
 $('nearText').textContent=nearest?.node?words[nearest.node.kind]:nearest?.npc?nearest.npc.name+(nearest.kind==='local'?'':' · '+species[nearest.npc.species]):S.riding?tr('Кухня — K · выход — F','Kitchen — K · exit — F'):truckDistance()<3.5?tr('Кухня — внутри вездехода','Kitchen is inside the rover'):tr('E — собрать или поговорить','E — gather or talk');
 $('desktopContext').textContent=(nearest?'E · '+$('action').textContent.replace(' · E','')+' — '+(nearest.node?words[nearest.node.kind]:nearest.npc.name)+'   /   ':'')+'F · '+$('vehicle').textContent.replace(' · F','')+(S.riding?'   /   K · '+tr('Кухня','Kitchen'):'');
 const target=trackedTarget();$('guide').hidden=!target;
 if(target){$('guideText').textContent=(target.kind==='truck'?tr('Вездеход','Rover'):target.kind==='npc'?target.name:words[target.kind])+' · '+Math.round(Math.hypot(target.x-S.x,target.z-S.z))+tr(' м',' m');const angle=Math.atan2(target.x-S.x,-(target.z-S.z))-footYaw;$('guideArrow').style.transform='rotate('+angle+'rad)'}
 const stage=S.cook?cr.steps[S.cook.step]:null;
 $('openBook').disabled=false;$('useOrder').disabled=!r||!!S.cook||S.dish!==null;
 $('chosenName').textContent=tr('Готовим: ','Cooking: ')+cr.name;
 $('qualityInfo').dataset.bad=String(!!S.cook?.errors?.length||!!S.dishFaults.length||(r&&cr.id!==r.id));
 $('qualityInfo').textContent=S.dish!==null?recipes[S.dish].name+' · '+(S.dishFaults.length?S.dishFaults.join(', '):tr('готово','ready')):S.cook?.errors?.length?tr('Ошибки: ','Faults: ')+S.cook.errors.join(', '):r&&cr.id!==r.id?tr('Не тот рецепт! Заказчик удержит 1 монету.','Wrong recipe! Customer will charge 1 coin.'):tr('Верное блюдо: +','Correct dish: +')+(r?.price||2)+tr(' V · ошибка: −1 V',' V · mistake: −1 V');
 $('skipStep').hidden=!S.cook;$('discard').hidden=!S.cook&&S.dish===null;
 $('stationTitle').textContent=stage?stageNames[stage]:S.dish!==null?tr('Проверь блюдо перед подачей','Check before serving'):tr('Выбери рецепт','Choose a recipe');
 $('stepCount').textContent=stage?(S.cook.step+1)+' / '+cr.steps.length:tr('8 СТАНЦИЙ','8 STATIONS');
 $('catchFood').hidden=!S.cook||stableGravity();$('nextStep').hidden=!['fry','boil','season'].includes(stage);$('nextStep').textContent=stage==='season'?tr('Готово','Finish'):tr('Снять','Take off');$('heatTrack').hidden=!['fry','boil'].includes(stage);
 $('work').disabled=false;
 let text='',hint='',progress=0;
 if(!S.active){text=tr('Нужен заказ','Take an order first');hint=tr('Выйди из машины и поговори с жителем.','Get out and talk to a resident.');$('work').disabled=true}
 else if(S.dish!==null){text=tr('К доставке','Go deliver');hint=tr('Проверь название и качество. Неверное или испорченное блюдо: −1 монета.','Check name and quality. Wrong or spoiled dish: −1 coin.')}
 else if(!S.cook){text=enough()?tr('Начать готовить','Start cooking'):tr('Нужны ингредиенты','Gather ingredients');hint=Object.entries(cr.need).map(([k,n])=>words[k]+' '+S.inventory[k]+'/'+n).join(' · ');$('work').disabled=!enough()}
 else if(stage!==selected){text=tr('Выбери станцию','Select the station');hint=stageNames[stage];$('work').disabled=true}
 else if(stage==='chop'){text=tr('Нарезать','Chop')+' · '+S.cook.chops+'/5';hint=tr('Пять аккуратных движений ножом.','Five careful knife strokes.');progress=S.cook.chops/5}
 else if(['wash','mix','blend'].includes(stage)){const goal=stage==='wash'?3:stage==='blend'?6:8;text=stageNames[stage]+' · '+S.cook.mix+'/'+goal;hint=tr('Нажимай для каждого действия. Не пропускай этап.','Tap for each action. Do not skip the step.');progress=S.cook.mix/goal}
 else if(['fry','boil'].includes(stage)){text=tr('Удерживай: нагрев','Hold to heat');hint=tr('Зелёная зона: 55–84%. Снимешь раньше — сыро. Передержишь — сгорит.','Green zone: 55–84%. Too early is raw; too long burns.');progress=S.cook.heat}
 else if(stage==='season'){text=tr('Добавить щепотку','Add a pinch')+' · '+S.cook.season;hint=tr('Нужно ровно ','Exactly ')+(cr.season||1)+tr(' щепотки. Затем «Готово».',' pinches, then Finish.');progress=S.cook.season/(cr.season||1)}
 else {text=S.cook.door===0?tr('Поставить в духовку','Put in oven'):S.cook.door===1?tr('Закрыть дверцу','Close door'):S.cook.oven<6?tr('Достать · ещё сыро','Take out · still raw'):S.cook.oven<=10?tr('Достать · готово','Take out · ready'):tr('Достать · сгорело','Take out · burnt');hint=tr('После закрытия: 6–10 с — готово. Раньше — сыро, позже — сгорит. Таймер: ','After closing: ready at 6–10s. Earlier is raw, later burns. Timer: ')+S.cook.oven.toFixed(1)+tr(' с',' s');progress=S.cook.oven/10}
 $('work').textContent=text;$('stationHint').textContent=hint;$('workProgress').style.width=Math.min(1,progress)*100+'%';$('heatNeedle').style.left=Math.min(1,S.cook?.heat||0)*100+'%';
 document.querySelectorAll('[data-station]').forEach(b=>{b.classList.toggle('needed',b.dataset.station===stage);b.classList.toggle('on',b.dataset.station===selected)});
 $('gravityNote').textContent=stableGravity()?S.completed>=4?tr('Магнитная столешница активна','Magnetic worktop active'):tr('Гравитация стабильна','Stable gravity'):tr('Низкая гравитация · продукты парят','Low gravity · floating food');
 if(view==='kitchen'){const panel=document.querySelector('.kitchen-panel').getBoundingClientRect(),w=innerWidth,h=innerHeight;let ox=0,oy=0;if(document.body.dataset.input!=='desktop'&&w<600&&h>500)oy=h/2-(68+panel.top)/2;else ox=document.body.dataset.input==='desktop'||w>=1024?-panel.right/2:(w-panel.left)/2;kitchenCamera.setViewOffset(w,h,ox,oy,w,h)}
}
const mapCtx=$('map').getContext('2d');
function drawMap(){
 const g=mapCtx,w=168,span=mapWide?WORLD*2:220,cx=mapWide?0:S.x,cz=mapWide?0:S.z;
 const tx=x=>(x-cx+span/2)/span*w,tz=z=>(z-cz+span/2)/span*w;
 g.clearRect(0,0,w,w);g.fillStyle='#c6cba9';g.fillRect(0,0,w,w);g.fillStyle='#d3ae8e';g.fillRect(tx(28),0,w,w);g.fillStyle='#cedde0';g.fillRect(0,0,w,tz(-140));g.fillStyle='#719e95';g.fillRect(0,tz(160),tx(40),w);
 g.strokeStyle='#a18b69';g.lineWidth=mapWide?1.1:2;for(const n of folks){g.beginPath();g.moveTo(tx(0),tz(0));g.lineTo(tx(n.x),tz(n.z));g.stroke()}g.lineWidth=1;
 g.strokeStyle='#526c4820';for(let i=0;i<w;i+=24){g.beginPath();g.moveTo(i,0);g.lineTo(i,w);g.moveTo(0,i);g.lineTo(w,i);g.stroke()}
 for(const n of nodeList)if(t>=n.ready){g.fillStyle='#'+colors[n.kind].toString(16).padStart(6,'0');g.beginPath();g.arc(tx(n.x),tz(n.z),mapWide?1.25:n.kind==='soda'?3:2,0,7);g.fill()}
 for(const n of folks){g.strokeStyle='#fff0c3';g.fillStyle=S.active?.npc===n.id?'#9c5841':'#416d5d';g.beginPath();g.arc(tx(n.x),tz(n.z),5,0,7);g.fill();g.stroke();g.fillStyle='#fff9e7';g.textAlign='center';g.font='bold 7px sans-serif';g.fillText(n.name[0],tx(n.x),tz(n.z)+2.5)}
 const target=trackedTarget();if(target){g.strokeStyle='#355744';g.lineWidth=1.5;g.beginPath();g.arc(tx(target.x),tz(target.z),7,0,7);g.stroke();g.setLineDash([3,3]);g.beginPath();g.moveTo(tx(S.x),tz(S.z));g.lineTo(tx(target.x),tz(target.z));g.stroke();g.setLineDash([])}
 g.fillStyle='#2e6661';g.fillRect(tx(S.truck.x)-4,tz(S.truck.z)-3,8,6);g.strokeStyle='#fff4d5';g.strokeRect(tx(S.truck.x)-4,tz(S.truck.z)-3,8,6);
 g.save();g.translate(tx(S.x),tz(S.z));g.rotate(S.riding?S.heading:footYaw);g.fillStyle='#fff9e9';g.strokeStyle='#31493e';g.lineWidth=2;g.beginPath();g.moveTo(0,-7);g.lineTo(5,5);g.lineTo(0,3);g.lineTo(-5,5);g.closePath();g.fill();g.stroke();g.restore();
 $('mapZoom').textContent=mapWide?tr('Весь мир · 1 км','World · 1 km'):tr('Рядом · 220 м','Nearby · 220 m');
}
camera.position.set(S.x,6,S.z+6);kitchenCamera.position.set(0,3,3);const ray=new T.Raycaster(),mouse=new T.Vector2();
cameraRig=new RoverCamera({element:$('world'),worldCamera:camera,kitchenCamera,terrain:elevation,solids:()=>solidObjects,enabled:()=>mode==='playing'&&$('cookbook').hidden&&!document.body.dataset.sheet&&$('cameraHelp').hidden,focus:()=>({context:view==='kitchen'?'kitchen':S.riding?'vehicle':'foot',heading:S.heading,position:view==='kitchen'?new T.Vector3(stationX[selected]*.48,1.24,stationZ[selected]*.48):new T.Vector3(S.x,elevation(S.x,S.z)+(S.riding?1.9:1.15),S.z)}),tap:e=>{if(view!=='kitchen')return;const r=$('world').getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,kitchenCamera);const hits=ray.intersectObjects(stationHits);if(hits[0])selectStation(hits[0].object.userData.station)}});
function update(dt){t+=dt;if(mode==='playing'&&$('cookbook').hidden&&!document.body.dataset.sheet&&$('cameraHelp').hidden){
 if(view==='drive'){
  const f=Number(!!(keys.KeyW||keys.ArrowUp||touch.forward))-Number(!!(keys.KeyS||keys.ArrowDown||touch.back))-joy.y,turn=Number(!!(keys.KeyD||keys.ArrowRight||touch.right))-Number(!!(keys.KeyA||keys.ArrowLeft||touch.left))+joy.x;
  if(S.riding){
   const max=S.completed>=2?28:18;speed=T.MathUtils.damp(speed,T.MathUtils.clamp(f,-1,1)*max,3.5,dt);S.heading+=turn*dt*1.75*(Math.abs(speed)>1?Math.sign(speed):.8);
   S.x=T.MathUtils.clamp(S.x+Math.sin(S.heading)*speed*dt,-WORLD,WORLD);S.z=T.MathUtils.clamp(S.z-Math.cos(S.heading)*speed*dt,-WORLD,WORLD);
   Object.assign(S.truck,{x:S.x,z:S.z,heading:S.heading});
  }else{
   const mag=Math.hypot(f,turn);speed=mag?(keys.ShiftLeft||keys.ShiftRight?6:3.8):0;
   if(mag){const dx=(Math.sin(footYaw)*f+Math.cos(footYaw)*turn)/mag,dz=(-Math.cos(footYaw)*f+Math.sin(footYaw)*turn)/mag;S.x=T.MathUtils.clamp(S.x+dx*speed*dt,-WORLD,WORLD);S.z=T.MathUtils.clamp(S.z+dz*speed*dt,-WORLD,WORLD);S.heading=Math.atan2(dx,-dz);walkCycle+=speed*dt*2.5}
   // Keep the walker outside the parked vehicle, including its rotated footprint.
   const h=S.truck.heading,c=Math.cos(h),sn=Math.sin(h),dx=S.x-S.truck.x,dz=S.z-S.truck.z;let lx=c*dx+sn*dz,lz=-sn*dx+c*dz;
   if(Math.abs(lx)<1.72&&Math.abs(lz)<2.63){if(1.72-Math.abs(lx)<2.63-Math.abs(lz))lx=lx<0?-1.72:1.72;else lz=lz<0?-2.63:2.63;S.x=S.truck.x+c*lx-sn*lz;S.z=S.truck.z+sn*lx+c*lz}
  }
 }

 if(view==='drive')resolveScenery();
 if(S.cook){const stage=cookingRecipe().steps[S.cook.step];
  if(['fry','boil'].includes(stage)){S.cook.heat=T.MathUtils.clamp(S.cook.heat+(workHeld&&view==='kitchen'&&selected===stage?(stage==='boil'?.16:.21):-.07)*dt,0,1);if(S.cook.heat>.9){S.cook.hot=(S.cook.hot||0)+dt;if(S.cook.hot>1.2)fault(tr('подгорело','burnt'))}flame.visible=workHeld&&stage==='fry';potRing.visible=workHeld&&stage==='boil';pan.material=mat(S.cook.heat>.84?0x8f6654:0x434d4f)}
  if(stage==='bake'&&S.cook.door===2){S.cook.oven=Math.min(18,S.cook.oven+dt);if(S.cook.oven>10)fault(tr('сгоревшая выпечка','burnt bake'))}
 }
 tapWater.visible=!!S.cook&&selected==='wash';
 for(let i=0;i<steam.length;i++){const a=steam[i];a.visible=!!S.cook&&['boil','fry','bake'].includes(selected);if(a.visible){const f=(t*.3+i*.14)%1;a.position.set(stationX[selected]+Math.sin(i+t)*.25,2.8+f*1.4,stationZ[selected]);a.scale.setScalar(.24+f*.5);a.material.opacity=(1-f)*.18}}

 knifeKick=Math.max(0,knifeKick-dt*5);knife.position.y=2.89-Math.sin(knifeKick*Math.PI)*.3;spoon.rotation.y=T.MathUtils.damp(spoon.rotation.y,stir,8,dt);ovenDoor.rotation.x=T.MathUtils.damp(ovenDoor.rotation.x,S.cook?.door===1?Math.PI*.45:0,9,dt);
 for(const f of foodBits){if(!f.o.visible)continue;f.v.y-=(stableGravity()?5:.7)*dt;f.o.position.addScaledVector(f.v,dt);f.v.x*=Math.exp(-dt*2);f.v.z*=Math.exp(-dt*2);if(f.o.position.y<f.rest){f.o.position.y=f.rest;f.v.y=f.returning?0:Math.abs(f.v.y)*.2;f.returning=false}if(f.o.position.y>4.5){f.o.position.y=4.5;f.v.y=-.2}f.o.position.x=T.MathUtils.clamp(f.o.position.x,f.base.x-.45,f.base.x+.45);f.o.position.z=T.MathUtils.clamp(f.o.position.z,f.base.z-.4,f.base.z+.4);}
 saveClock+=dt;if(saveClock>3){saveClock=0;save()}
 }
 rover.position.set(S.truck.x,elevation(S.truck.x,S.truck.z)+.04,S.truck.z);rover.rotation.y=-S.truck.heading;rover.rotation.z=S.riding?Math.sin(t*6)*Math.min(.025,Math.abs(speed)*.002):0;
 if(S.riding)for(const w of wheels)w.rotation.x-=speed*dt/.75;
 chef.visible=!S.riding;chef.position.set(S.x,elevation(S.x,S.z)+.03,S.z);chef.rotation.y=Math.PI-S.heading;
 for(let i=0;i<2;i++){const swing=!S.riding&&speed>0?Math.sin(walkCycle+i*Math.PI)*.55:0;legs[i].rotation.x=swing;arms[i].rotation.x=-swing*.75}
 environment.update(t,S.x,S.z);
 const guideTarget=trackedTarget();
 for(const n of nodeList){const ready=t>=n.ready;n.item.visible=ready;n.halo.visible=ready;const distance=Math.hypot(n.x-S.x,n.z-S.z);n.g.visible=distance<100;n.marker.visible=ready&&(distance<7||(n===guideTarget&&distance<26)||(n.kind==='soda'&&distance<17));
  if(n.kind==='berry')n.item.position.y=Math.sin(t*1.6+n.phase)*.035;
  for(let j=0;j<n.bubbles.length;j++){const b=n.bubbles[j];b.position.y=.15+((t*.35+j*.2)% .52);b.scale.setScalar(.03+.02*Math.sin(t*2+j)**2)}
  n.halo.material.color.setHex(n===guideTarget?0xffe8a1:colors[n.kind]);
 }
 for(let i=0;i<aliens.length;i++){const a=aliens[i],u=a.userData,n=folks[i],near=Math.hypot(S.x-n.x,S.z-n.z)<6;a.parent.visible=Math.hypot(S.x-n.x,S.z-n.z)<220;a.position.y=u.hover?.1+Math.sin(t*1.5+i)*.045:0;a.rotation.y=T.MathUtils.damp(a.rotation.y,near?Math.atan2(S.x-n.x,S.z-n.z-2):Math.sin(t*.25+i)*.08,3,dt);u.head.rotation.z=Math.sin(t*.7+i)*.025;u.head.position.y=u.headY+Math.sin(t*1.4+i)*.004;u.eyes.scale.y=(t+i*.43)%4.7<.13?.13:1;u.wings.forEach((w,j)=>w.rotation.y=(j?1:-1)*(1+Math.sin(t*2.2+i)*.06));if(u.arms[1])u.arms[1].rotation.x=T.MathUtils.damp(u.arms[1].rotation.x,near?-.35+Math.sin(t*3)*.07:0,4,dt)}
 chef.userData.eyes.scale.y=t%5.3<.12?.15:1;chef.userData.head.rotation.z=Math.sin(t)*.013;
 sun.position.set(S.x-25,65,S.z+20);sun.target.position.set(S.x,0,S.z);
 cameraRig.update(dt);footYaw=cameraRig.states[S.riding?'vehicle':'foot'].cyaw;
 rearShell.visible=kitchenCamera.position.z>-1.95&&kitchenCamera.position.x>-2.3;
 uiClock+=dt;if(uiClock>.12){uiClock=0;findNearest();updateUI();drawMap()}if(t>toastUntil)$('toast').classList.remove('show');
}
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=kitchenCamera.aspect=w/h;camera.updateProjectionMatrix();kitchenCamera.updateProjectionMatrix();clearInput()}
function frame(now){const dt=Math.min(.045,(now-last)/1000);last=now;update(mode==='paused'?0:dt);renderer.render(view==='drive'?scene:kitchen,view==='drive'?camera:kitchenCamera);requestAnimationFrame(frame)}
function pause(){if(mode!=='playing')return;$('cookbook').hidden=true;mode='paused';document.body.dataset.mode='paused';clearInput();save();$('intro').hidden=false;$('introTitle').innerHTML=tr('Тихая<br><em>остановка.</em>','A little<br><em>pit stop.</em>');$('introDesc').textContent=tr('Заказ и продукты подождут. Продолжим экспедицию?','Your order and ingredients can wait. Continue exploring?');$('start').textContent=tr('Продолжить путь →','Continue exploring →')}
function start(){openSheet('');$('cameraHelp').hidden=true;mode='playing';document.body.dataset.mode='playing';$('intro').hidden=true;last=performance.now();clearInput();updateUI()}
window.addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='roverPenaltyResult'&&e.data.charged===0)toast(tr('Заказ отклонён. Монет для компенсации нет; баланс остался 0.','Order rejected. No coins for compensation; balance stays at zero.'))});
$('start').onclick=start;$('pause').onclick=()=>mode==='paused'?start():pause();$('switch').onclick=switchView;$('vehicle').onclick=toggleVehicle;$('findSoda').onclick=()=>{trackedKind='soda';updateUI();toast(tr('Голубой источник отмечен стрелкой и на карте.','Follow the arrow to the blue spring marked on the map.'))};$('ingredients').onclick=e=>{const row=e.target.closest('[data-resource]');if(row){trackedKind=row.dataset.resource;updateUI()}};$('ingredients').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.target.click()}};$('action').onclick=interact;$('home').onclick=()=>{save();clearInput();if(parent!==window)send('home');else location.href='../index.html'};$('sound').onclick=()=>{soundOn=!soundOn;$('sound').textContent=soundOn?'♪':'♩';$('sound').ariaLabel=tr('Звук: ','Sound: ')+(soundOn?tr('вкл','on'):tr('выкл','off'));if(soundOn)beep()};
$('work').addEventListener('pointerdown',e=>{if(mode!=='playing'||$('work').disabled)return;e.preventDefault();$('work').setPointerCapture(e.pointerId);if(S.dish!==null){switchView();return}if(S.cook&&['fry','boil'].includes(selected)&&cookingRecipe().steps[S.cook.step]===selected)workHeld=true;else work()});for(const ev of ['pointerup','pointercancel','lostpointercapture'])$('work').addEventListener(ev,()=>workHeld=false);$('work').addEventListener('click',e=>{if(e.detail===0){if(S.dish!==null)switchView();else work()}});$('nextStep').onclick=finishFry;$('catchFood').onclick=()=>{for(const f of foodBits){f.v.y=-3;f.returning=true;}toast(tr('Ингредиенты возвращаются на стол.','Ingredients are returning to the worktop.'))};
for(const btn of document.querySelectorAll('[data-station]'))btn.onclick=()=>selectStation(btn.dataset.station);
for(const btn of document.querySelectorAll('[data-drive]')){btn.addEventListener('pointerdown',e=>{if(mode!=='playing'||view!=='drive'||driveOwners.has(btn))return;e.preventDefault();driveOwners.set(btn,e.pointerId);touch[btn.dataset.drive]=true;btn.classList.add('held');btn.setPointerCapture(e.pointerId)});for(const name of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(name,e=>{if(driveOwners.get(btn)!==e.pointerId)return;driveOwners.delete(btn);touch[btn.dataset.drive]=false;btn.classList.remove('held')})}
document.addEventListener('keydown',e=>{if(e.target.matches('select,input,textarea'))return;if(e.code==='Escape'&&(document.body.dataset.sheet||!$('cameraHelp').hidden)){openSheet('');$('cameraHelp').hidden=true;return}if(document.body.dataset.sheet&&['KeyM','KeyJ','KeyI'].includes(e.code)&&!e.repeat){openSheet({KeyM:'map',KeyJ:'order',KeyI:'bag'}[e.code]);return}if(document.body.dataset.sheet||!$('cameraHelp').hidden)return;if(e.code==='KeyR'&&mode==='playing')cameraRig.reset();if(mode==='playing'&&!e.repeat&&['KeyM','KeyJ','KeyI'].includes(e.code)){openSheet({KeyM:'map',KeyJ:'order',KeyI:'bag'}[e.code]);return}if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(!$('cookbook').hidden){if(e.code==='Escape')$('cookbook').hidden=true;return}if(e.code==='Escape'){if(mode==='playing')pause();else if(mode==='paused')start();return}if(mode!=='playing')return;keys[e.code]=true;if(e.repeat)return;if(e.code==='KeyK')switchView();if(e.code==='KeyF')toggleVehicle();if(e.code==='KeyE')interact();if(e.code==='Space'&&view==='kitchen'){if(S.dish!==null)switchView();else if(S.cook&&['fry','boil'].includes(selected))workHeld=true;else work()}if(e.code==='Enter'&&view==='kitchen')finishFry();const idx=Number(e.key)-1;if(idx>=0&&idx<8)selectStation(Object.keys(stationX)[idx])});document.addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='Space')workHeld=false});window.addEventListener('blur',()=>{if(mode==='playing')pause();clearInput()});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});window.addEventListener('resize',resize);window.addEventListener('pagehide',save);
for(const el of document.querySelectorAll('[data-en]'))if(en)el.textContent=el.dataset.en;
$('introTitle').innerHTML=tr('Космо<br><em>кухня.</em>','Cosmic<br><em>Kitchen.</em>');
if(!storageOK)$('saveNote').textContent=tr('Хранилище недоступно: прогресс только до закрытия игры.','Storage unavailable: progress lasts for this session only.');
$('mapToggle').onclick=()=>openSheet('map');
function renderBook(){
 const ordered=S.active?recipes[S.active.recipe]:null;
 $('bookOrder').textContent=ordered?tr('Заказчик ждёт: ','Customer ordered: ')+ordered.name+' · +'+ordered.price+tr(' монет. Ошибка: −1.',' coins. Mistake: −1.'):tr('Сначала возьми заказ у жителя.','Take an order from a resident first.');
 $('recipeCards').innerHTML=recipes.map(r=>'<button class="recipe-card '+(r.id===chosenRecipe?'chosen ':'')+(r.id===ordered?.id?'requested':'')+'" data-recipe="'+r.id+'" '+(S.cook||S.dish!==null?'disabled':'')+'><small>'+r.steps.length+tr(' этапа · ',' steps · ')+(r.id===ordered?.id?tr('ЗАКАЗ','ORDER'):'')+'</small><b>'+r.name+'</b><strong>+'+r.price+' V</strong><p>'+Object.entries(r.need).map(([k,n])=>words[k]+' ×'+n+' ('+S.inventory[k]+')').join(' · ')+'</p><span>'+r.steps.map(k=>stageNames[k]).join(' → ')+'</span></button>').join('');
}
$('openBook').onclick=()=>{if(view!=='kitchen'||!S.riding)return;clearInput();renderBook();$('cookbook').hidden=false};
$('closeBook').onclick=()=>$('cookbook').hidden=true;
$('recipeCards').onclick=e=>{const card=e.target.closest('[data-recipe]');if(!card)return;chosenRecipe=Number(card.dataset.recipe);$('cookbook').hidden=true;updateUI()};
$('useOrder').onclick=()=>{if(S.active&&!S.cook&&S.dish===null){chosenRecipe=S.active.recipe;updateUI()}};
$('skipStep').onclick=()=>{if(S.cook){fault(tr('пропущен этап','skipped step'));advance()}};
$('resourceSelect').innerHTML='<option value="">'+tr('Что искать?','Find ingredient…')+'</option>'+Object.entries(words).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');$('resourceSelect').onchange=e=>{trackedKind=e.target.value||null;clearInput();updateUI()};
$('discard').onclick=()=>{if(!S.cook&&S.dish===null)return;S.cook=null;S.dish=null;S.dishFaults=[];chosenRecipe=S.active?.recipe??0;arrangeFood();save();updateUI();toast(tr('Блюдо выброшено. Потраченные продукты не возвращаются.','Dish discarded. Used ingredients are not refunded.'))};
$('mapZoom').onclick=()=>{mapWide=!mapWide;drawMap()};
$('map').onclick=e=>{const r=$('map').getBoundingClientRect(),span=mapWide?WORLD*2:220,cx=mapWide?0:S.x,cz=mapWide?0:S.z;const x=cx+(e.clientX-r.left)/r.width*span-span/2,z=cz+(e.clientY-r.top)/r.height*span-span/2;const n=[...folks].sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];trackedKind='npc:'+n.id;toast(tr(...environment.names[n.id])+' · '+n.name+' · '+species[n.species]+': '+n.taste);updateUI();drawMap()};
$('orderToggle').onclick=()=>openSheet('');
function openSheet(name){const next=document.body.dataset.sheet===name?'':name;document.body.dataset.sheet=next;clearInput();document.querySelectorAll('.sheet[data-sheet]').forEach(el=>el.hidden=el.dataset.sheet!==next);document.querySelectorAll('[data-open]').forEach(el=>{el.classList.toggle('active',el.dataset.open===next);el.ariaExpanded=String(el.dataset.open===next)});$('worldNav').classList.toggle('active',!next);$('sheetShade').hidden=!next;}
$('worldNav').onclick=()=>{openSheet('');if(view==='kitchen')switchView()};
for(const b of document.querySelectorAll('[data-open]'))b.onclick=()=>openSheet(b.dataset.open);
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>openSheet('');
$('sheetShade').onclick=()=>openSheet('');$('resetCamera').onclick=()=>cameraRig.reset();$('helpCamera').onclick=()=>{clearInput();$('cameraHelp').hidden=false};$('closeHelp').onclick=()=>$('cameraHelp').hidden=true;
$('stationPicker').innerHTML=Object.entries(stageNames).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');$('stationPicker').onchange=e=>selectStation(e.target.value);
const stick=$('stick');stick.addEventListener('pointerdown',e=>{if(mode!=='playing'||view!=='drive'||joy.id!==null)return;e.preventDefault();joy.id=e.pointerId;stick.setPointerCapture(e.pointerId);moveStick(e)});function moveStick(e){if(joy.id!==e.pointerId)return;const r=stick.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,d=Math.hypot(x,y),k=d>36?36/d:1;joy.x=x*k/36;joy.y=y*k/36;if(d<6)joy.x=joy.y=0;$('stickNub').style.transform='translate('+x*k+'px,'+y*k+'px)'}stick.addEventListener('pointermove',moveStick);for(const ev of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(ev,e=>{if(joy.id!==e.pointerId)return;joy.id=null;joy.x=joy.y=0;$('stickNub').style.transform='translate(0,0)'});
// Batch rigid details locally, while keeping every moving/interactive part independent.
function mergeCompatible(gs){if(gs.some(g=>!g.index)&&gs.some(g=>g.index)){for(let i=0;i<gs.length;i++)if(gs[i].index){const old=gs[i];gs[i]=old.toNonIndexed();old.dispose()}}return mergeGeometries(gs)}
function batchLocal(root,protectedObjects=new Set()){
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),byMat=new Map();
 root.traverse(o=>{if(!o.isMesh||!o.visible||Array.isArray(o.material))return;for(let a=o;a&&a!==root;a=a.parent)if(!a.visible||protectedObjects.has(a))return;if(!byMat.has(o.material))byMat.set(o.material,[]);byMat.get(o.material).push(o)});
 for(const [material,list]of byMat){if(list.length<2)continue;const gs=list.map(o=>o.geometry.clone().applyMatrix4(inverse.clone().multiply(o.matrixWorld))),geo=mergeCompatible(gs);if(geo){list.forEach(o=>o.removeFromParent());const m=new T.Mesh(geo,material);m.castShadow=list.some(o=>o.castShadow);m.receiveShadow=true;root.add(m)}gs.forEach(g=>g.dispose())}
}
for(const n of nodeList){batchLocal(n.item,new Set(n.bubbles));batchLocal(n.g,new Set([n.item,n.halo]));}
batchLocal(rover,new Set([...wheels,engineGlow]));batchLocal(chef,new Set([...legs,...arms,chef.userData.head]));for(const a of aliens)batchLocal(a,new Set([...a.userData.legs,...a.userData.arms,a.userData.head,...a.userData.wings]));
batchLocal(kitchen,new Set([rearShell,knife,spoon,ovenDoor,pan,flame,potRing,tapWater,...stationHits,...plated,...foodBits.map(f=>f.o)]));
for(const l of environment.locals)batchLocal(l.g,new Set([l.g.userData.head]));
for(const town of environment.towns)batchLocal(town,new Set([...aliens.map(a=>a.parent),...environment.locals.map(l=>l.g)]));
for(const g of environment.props)batchLocal(g);batchLocal(environment.roads);
// Batch static scenery by material; animated truck, plants and locals stay separate.
scene.updateMatrixWorld(true);
const animatedRoots=new Set([environment.root,...environment.towns,rover,chef,...nodeList.map(n=>n.g),...aliens.map(a=>a.parent)]), batches=new Map();
scene.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;for(let p=o;p;p=p.parent)if(animatedRoots.has(p))return;const key=o.material.uuid;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(o)});
for(const objects of batches.values()){if(objects.length<2)continue;const geos=objects.map(o=>o.geometry.clone().applyMatrix4(o.matrixWorld));const geo=mergeCompatible(geos);if(geo){const m=new T.Mesh(geo,objects[0].material);m.castShadow=objects.some(o=>o.castShadow);m.receiveShadow=true;scene.add(m);objects.forEach(o=>o.removeFromParent())}geos.forEach(g=>g.dispose())}
arrangeFood();resize();updateUI();drawMap();requestAnimationFrame(frame);
// Diagnostics and normal player actions for reproducible local QA.
window.roverGame={environment,solidObjects,camera:cameraRig,renderer,scene,kitchen,cameras:{world:camera,kitchen:kitchenCamera},aliens,terrain:elevation,state:S,recipes,folks,nodeList,worldSize:WORLD*2,get chosenRecipe(){return chosenRecipe},chooseRecipe(id){if(recipes[id]&&!S.cook&&S.dish===null){chosenRecipe=id;updateUI()}},get species(){return species},get mode(){return mode},get view(){return view},get nearest(){return nearest},get food(){return foodBits},start,pause,interact,toggleVehicle,trackedTarget,get avatar(){return chef},get vehicleModel(){return rover},switchView,beginCook,work,finishFry,selectStation,update};
