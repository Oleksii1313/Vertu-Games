import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
// Aurelia character language: sculpted silhouettes, soft bevels, stitched clothing.
const C={cream:0xf2e9d5,ink:0x273d43,teal:0x4f8079,clay:0xcf8b62,sage:0xa4b595,plum:0x927f9c,ice:0xa6c6d4,gold:0xc5a264};
const materials=new Map();
function mat(c,rough=.82,metal=0){const k=[c,rough,metal].join(':');if(!materials.has(k))materials.set(k,new T.MeshStandardMaterial({color:c,roughness:rough,metalness:metal}));return materials.get(k)}
function add(parent,geo,color,x=0,y=0,z=0,rough=.82,metal=0){const m=new T.Mesh(geo,mat(color,rough,metal));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m}
function rounded(parent,x,y,z,w,h,d,color,r=.035){return add(parent,new RoundedBoxGeometry(w,h,d,3,Math.min(r,w*.4,h*.4,d*.4)),color,x,y,z)}
function ellipsoid(parent,x,y,z,rx,ry,rz,color){const m=add(parent,new T.SphereGeometry(1,20,14),color,x,y,z);m.scale.set(rx,ry,rz);return m}
function capsule(parent,x,y,z,r,len,color){return add(parent,new T.CapsuleGeometry(r,len,4,12),color,x,y,z)}
function profile(parent,points,color,x=0,y=0,z=0,flatten=.76,segments=24){const m=add(parent,new T.LatheGeometry(points.map(([r,h])=>new T.Vector2(r,h)),segments),color,x,y,z);m.scale.z=flatten;return m}
function seam(parent,points,color=C.gold,r=.005){return add(parent,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),18,r,5,false),color)}
function softShape(parent,shape,color,thickness=.025){const m=add(parent,new T.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.01,bevelThickness:.008,curveSegments:12}),color);return m}
function leafShape(){const s=new T.Shape();s.moveTo(0,0);s.bezierCurveTo(-.17,.13,-.13,.36,0,.48);s.bezierCurveTo(.15,.32,.16,.1,0,0);return s}
function sculptedHead(){const g=new T.SphereGeometry(1,24,18),p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i),jaw=.71+.29*T.MathUtils.smoothstep(y,-.7,.25);p.setXYZ(i,p.getX(i)*jaw,p.getY(i),p.getZ(i)*(y<-.3?.88:1))}g.computeVertexNormals();return g}
function face(root,skin,mechanical=false){const h=new T.Group();h.position.y=1.405;root.add(h);const head=add(h,mechanical?new RoundedBoxGeometry(.355,.32,.29,4,.095):sculptedHead(),skin);if(!mechanical)head.scale.set(.18,.207,.164);
 const eyes=new T.Group();eyes.position.set(0,.025,mechanical?.177:.15);h.add(eyes);
 if(mechanical)rounded(h,0,.024,.15,.285,.085,.035,C.ink,.025);
 for(const x of [-.066,.066]){ellipsoid(eyes,x,0,.007,mechanical?.018:.019,.027,.009,mechanical?C.gold:C.ink);ellipsoid(eyes,x-.005,.01,.015,.005,.006,.004,C.cream);if(!mechanical)seam(h,[[x-.025,.082,.146],[x,.09,.153],[x+.023,.085,.148]],0x5b5348,.006)}
 if(!mechanical){ellipsoid(h,0,-.025,.164,.026,.025,.023,skin);seam(h,[[-.025,-.075,.15],[0,-.083,.158],[.025,-.075,.15]],0x876d60,.005)}
 root.userData.eyes=eyes;root.userData.head=h;root.userData.headY=h.position.y;return h;
}
function base(kind=0,chef=false){const g=new T.Group();const skins=[C.sage,0xaab8bb,0xc8ab96,0x9fbfba,0xc7d1cd,0xc5b18a,0xa5bcc4,0xb4a4af];const skin=chef?0xcf9e7e:skins[kind];const coat=chef?C.cream:[0x768e76,0x657e83,0xa48a83,0x779c96,0x99aba5,0xa49a7f,0x738994,0x8f7f90][kind];
 const torso=profile(g,[[0,.60],[.15,.60],[.215,.7],[.20,.87],[.245,1.09],[.22,1.18],[.09,1.235],[0,1.235]],coat,0,0,0,.73,kind===1?10:24);
 profile(g,[[0,.59],[.19,.59],[.205,.69],[.18,.73],[0,.73]],chef?C.teal:0x61706b,0,0,0,.78);
 capsule(g,0,1.25,0,.063,.09,skin);
 const head=face(g,skin,kind===4),legs=[],arms=[];
 for(const side of [-1,1]){
  const leg=new T.Group();leg.position.set(side*.118,.65,0);g.add(leg);capsule(leg,0,-.26,0,.068,.36,chef?0x536964:coat);rounded(leg,0,-.565,.047,.174,.13,.28,C.ink,.055);rounded(leg,0,-.617,.044,.18,.032,.287,0x66756c,.012);legs.push(leg);
  const arm=new T.Group();arm.position.set(side*.257,1.13,0);arm.rotation.z=side*.08;g.add(arm);capsule(arm,0,-.15,0,.066,.23,coat);profile(arm,[[0,-.335],[.069,-.335],[.069,-.28],[0,-.28]],chef?C.teal:skin,0,0,0,1);
  const hand=rounded(arm,0,-.39,.012,.105,.132,.085,chef?C.cream:skin,.032);ellipsoid(arm,-side*.057,-.363,.028,.025,.046,.025,chef?C.cream:skin);for(let k=0;k<2;k++)seam(arm,[[-.027+k*.04,-.407,.058],[-.027+k*.04,-.437,.057]],chef?0xc6c4ac:0x899287,.0025);arms.push(arm);
 }
 g.userData={...g.userData,legs,arms,kind,torso,wings:[],neutralY:0};
 // Soft collar and a single functional clasp shared by the whole art direction.
 profile(g,[[0,1.17],[.09,1.17],[.12,1.21],[.105,1.25],[0,1.25]],C.cream,0,0,0,.8);
 rounded(g,.07,1.13,.178,.047,.059,.02,C.gold,.01);
 return g;
}
export function makeChef(){const g=base(0,true);g.name='Chef — expedition atelier';
 const apron=rounded(g,0,.91,.17,.33,.46,.025,C.teal,.018);rounded(g,0,.83,.192,.215,.123,.018,0x628f83,.008);seam(g,[[-.1,.89,.207],[.1,.89,.207]],0x99ad91,.003);
 for(const side of [-1,1])seam(g,[[side*.125,1.03,.174],[side*.105,1.17,.153],[side*.1,1.21,.03]],C.teal,.018);
 const h=g.userData.head;profile(h,[[0,.177],[.174,.177],[.195,.208],[.21,.26],[.14,.295],[0,.285]],C.cream,0,0,0,.87);profile(h,[[0,.165],[.18,.165],[.18,.194],[0,.194]],C.teal,0,0,0,.88);
 rounded(g,0,.996,-.217,.325,.414,.168,0x66877c,.056);rounded(g,0,.963,-.307,.239,.205,.035,0x789989,.015);rounded(g,0,1.086,-.311,.113,.029,.012,C.cream,.005);
 for(const side of [-1,1])seam(g,[[side*.115,.77,-.13],[side*.18,1.13,-.14],[side*.145,1.2,.09]],0x536e65,.02);
 rounded(g,.231,.74,.012,.117,.175,.123,C.clay,.035);rounded(g,.236,.772,.08,.048,.025,.015,C.gold,.004);
 return g;
}
export function makeResident(kind=0,index=0){const g=base(kind,false);g.name='Aurelia resident / '+kind;const h=g.userData.head;
 // Tailored cross-body satchel: residents are travellers, not chefs in identical aprons.
 seam(g,[[-.16,1.17,.14],[.0,.96,.18],[.19,.74,.13]],0xd0b797,.017);rounded(g,.20,.76,.139,.164,.177,.104,0xb29371,.033);
 if(kind===0){for(const side of [-1,1]){const leaf=softShape(h,leafShape(),side<0?0x819773:0x9daf87);leaf.position.set(side*.075,.115,-.05);leaf.rotation.z=-side*.57;leaf.scale.setScalar(.53);seam(leaf,[[0,.05,.037],[0,.22,.037],[0,.40,.037]],0xb9c59c,.004)}
  const collar=profile(g,[[0,1.08],[.28,1.08],[.24,1.17],[.11,1.23],[0,1.23]],0x718b70,0,0,0,.78);}
 if(kind===1){h.children[0].geometry=new T.IcosahedronGeometry(1,1);h.children[0].scale.set(.189,.212,.157);h.children[0].material=mat(0xa8bfc6,.48);const inset=add(g,new T.OctahedronGeometry(.072),0xb4d4d7,0,1.045,.18,.3);inset.scale.set(.5,1,.3);for(const side of [-1,1])rounded(g,side*.115,.94,.163,.043,.18,.018,0x839da5,.013)}
 if(kind===2){const sh=new T.Shape();sh.moveTo(0,0);sh.bezierCurveTo(.40,.12,.47,.70,.09,.91);sh.bezierCurveTo(-.045,.67,-.045,.29,0,0);
  for(const side of [-1,1]){const wingRoot=new T.Group();wingRoot.position.set(side*.205,.70,-.105);wingRoot.rotation.y=side*1.0;g.add(wingRoot);const wing=softShape(wingRoot,sh,index%2?0xa18d9e:0x9fabb2,.035);wing.scale.x=side;const inner=softShape(wingRoot,sh,0xd4c5b9,.014);inner.scale.set(side*.72,.75,.5);inner.position.set(side*.047,.09,.043);seam(wing,[[.06,.08,.052],[.12,.40,.052],[.12,.76,.052]],0xc3b6a8,.009);g.userData.wings.push(wingRoot)}
  profile(h,[[0,.03],[.19,.03],[.22,.13],[.18,.24],[0,.26]],0xb7a395,0,0,-.035,.86);}
 if(kind===3){g.userData.torso.visible=false;g.userData.legs.forEach(a=>a.visible=false);g.userData.head.children[0].visible=false;
  const mantle=profile(g,[[0,.65],[.18,.64],[.31,.79],[.34,1.12],[.29,1.44],[.16,1.66],[0,1.70]],0x9dbcb5,0,0,-.025,.79);
  // Eyes stay part of the same continuous mantle, not a separate floating head.
  g.userData.eyes.position.z=.22;g.userData.arms.forEach(a=>{a.scale.set(.8,.85,.8)});
  const ribbon=new T.Shape();ribbon.moveTo(-.07,0);ribbon.bezierCurveTo(-.14,-.18,.05,-.28,-.04,-.47);ribbon.quadraticCurveTo(.09,-.53,.105,-.41);ribbon.bezierCurveTo(.18,-.2,.01,-.12,.075,0);ribbon.closePath();
  for(let j=0;j<4;j++){const fin=softShape(g,ribbon,j%2?0x86a99f:0xa6c5bb,.045);fin.position.set(Math.cos(j*Math.PI/2)*.14,.70,Math.sin(j*Math.PI/2)*.12);fin.rotation.y=j*Math.PI/2}
  g.userData.hover=true;}
 if(kind===4){g.userData.torso.geometry=new RoundedBoxGeometry(.44,.54,.33,4,.10);g.userData.torso.position.y=.935;g.userData.torso.scale.set(1,1,1);g.userData.torso.material=mat(0xc1cdc5,.62,.05);
  rounded(g,0,.995,.18,.20,.15,.018,0x7e9894,.025);for(let j=0;j<3;j++)rounded(g,(j-1)*.045,.973,.196,.013,.025,.01,C.gold,.004);
  for(const side of [-1,1]){ellipsoid(h,side*.194,0,0,.025,.061,.065,0x7e9591);const ring=add(g,new T.TorusGeometry(.058,.013,6,18),0x82948f,side*.267,1.095,0,.4,.35);ring.rotation.y=Math.PI/2;}}
 if(kind===5){g.scale.set(1.08,.87,1.03);const shell=ellipsoid(g,0,1.035,-.237,.334,.389,.239,0xb49c78);const pts=[];for(let i=0;i<70;i++){const f=i/69,a=f*Math.PI*4.5,r=.027+.20*f;pts.push([Math.cos(a)*r,1.04+Math.sin(a)*r,-.472+.022*f])}seam(g,pts,0x8d795c,.008);profile(h,[[0,.17],[.14,.17],[.15,.20],[0,.235]],0xa69c80,0,0,0,.9);}
 if(kind===6){g.userData.torso.scale.x=.87;h.scale.set(.89,1.06,1);const sh=new T.Shape();sh.moveTo(-.065,.025);sh.quadraticCurveTo(0,-.045,.065,.025);sh.lineTo(0,.10);sh.closePath();const beak=softShape(h,sh,0xc6a273,.11);beak.position.set(0,-.06,.165);beak.rotation.x=.2;
  for(const side of [-1,1]){const wing=softShape(g,leafShape(),0x78939d,.04);wing.position.set(side*.30,.64,.01);wing.scale.set(side*.75,1.25,1);wing.rotation.z=-side*.12;for(let j=0;j<2;j++)seam(wing,[[0,.12,.06],[.055-j*.04,.27,.06],[0,.40,.06]],0xa9bdc3,.005)}
  h.children[0].material=mat(0xb5c9cc);}
 if(kind===7){profile(h,[[0,.135],[.155,.135],[.26,.165],[.30,.213],[.235,.31],[.1,.345],[0,.33]],0x938299,0,0,-.015,.86);
  for(let j=0;j<6;j++){const a=j*Math.PI/3;rounded(h,Math.sin(a)*.245,.192,Math.cos(a)*.205,.017,.012,.017,0xcbbfad,.004)}
  profile(g,[[0,1.09],[.285,1.09],[.245,1.18],[.11,1.25],[0,1.25]],0x9f91a3,0,0,0,.79);}
 return g;
}
