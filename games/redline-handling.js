/* v6: common arcade tyre/engine model. Player and AI use identical controls.
   Substepping never creates speed by turning. No route positions enter this solver. */
function stepRedlineHandling(v,input,c,cfg={},dt,onRoad=true,limp=false){
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));dt=clamp(dt,0,.1);
 const ix=clamp(input.x||0,-1,1),iy=clamp(input.y||0,-1,1),hand=!!input.brake;
 const engine=cfg.engine||0,trans=cfg.transmission||0,susp=cfg.suspension||0;
 v.nitro=Number.isFinite(v.nitro)?v.nitro:100;v.steer=v.steer||0;v.yawRate=v.yawRate||0;
 const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;let boost=false,side=0;
 for(let k=0;k<steps;k++){
  let fx=Math.sin(v.yaw),fz=Math.cos(v.yaw),speed=v.vx*fx+v.vz*fz;const abs=Math.abs(speed),surface=onRoad?1:.67,tyres=v.tyres?.6:1,top=(c.top+trans*12)/3.6*(v.tyres?.55:1);
  const limit=c.steer/(1+abs*.031),steerTarget=Math.sign(ix)*Math.pow(Math.abs(ix),1.25)*limit;
  v.steer+=(steerTarget-v.steer)*(1-Math.exp(-h*(Math.abs(ix)<.06?20:15)));
  const corner=(c.grip*2.6+susp*1.2)*surface*tyres*(c.drive==='AWD'?1.06:1),grip=(hand?(c.drive==='FWD'?2.8:1.9):15.5+c.grip*.16+susp*.4)*surface*tyres;
  let targetYaw=Math.tan(v.steer)*speed/c.wb;
  targetYaw=clamp(targetYaw,-corner/Math.max(abs,8),corner/Math.max(abs,8));
  if(hand&&abs>6)targetYaw*=c.drive==='FWD'?1.12:1.30;
  v.yawRate+=(targetYaw-v.yawRate)*(1-Math.exp(-h*(hand?8:14)));
  if(abs<.15)v.yawRate=0;
  v.yaw+=v.yawRate*h;fx=Math.sin(v.yaw);fz=Math.cos(v.yaw);
  speed=v.vx*fx+v.vz*fz;side=(v.vx*fz-v.vz*fx)*Math.exp(-grip*h);
  // Progressive tyre recovery after handbrake release, not an instant heading snap.
  side=clamp(side,-Math.max(abs*.65,2),Math.max(abs*.65,2));
  const upgrade=1+engine*.13+trans*.025;
  let force=iy>0?(speed<-.35?21*iy:c.accel*1.38*upgrade*iy*Math.max(.25,1-.63*Math.max(0,speed)/top)):iy<0?(speed>.35?iy*(19.5+susp*.6):iy*c.accel*.64):0;
  boost=!!(!limp&&input.nitro&&v.nitro>0&&iy>0&&speed>2);
  if(boost){force+=c.accel*.9;v.nitro=Math.max(0,v.nitro-h*22)}else v.nitro=Math.min(100,v.nitro+h*(abs>10?6:3));
  force-=Math.sign(speed)*(.20+.00068*speed*speed)*(onRoad?1:3.1);
  if(abs>top&&!boost)force-=Math.sign(speed)*(abs-top)*2.2;
  if(hand)force-=Math.sign(speed)*Math.min(abs/Math.max(h,.001),5.1);
  if(limp){force=Math.min(0,force);speed*=Math.exp(-h*.9)}
  speed=clamp(speed+force*h,-11,top*(boost?1.18:1.015));
  if(!iy&&Math.abs(speed)<.25)speed=0;
  v.vx=fx*speed+fz*side;v.vz=fz*speed-fx*side;v.speed=speed;
 }
 return{boost,side,tireTurn:v.yawRate,throttle:iy};
}
/* Swept capsule against solid props; guardrails use the same swept segments as v5. */
function moveRedlineVehicle(v,dt,world,c){
 const radius=c.W*.48,half=Math.max(0,(c.L-c.W)/2),count=Math.max(1,Math.ceil(Math.hypot(v.vx,v.vz)*dt/.65));let impact=0;
 for(let i=0;i<count;i++){
  const old={x:v.x,z:v.z};v.x+=v.vx*dt/count;v.z+=v.vz*dt/count;
  const n=Math.sin(v.yaw),f=Math.cos(v.yaw),before=Math.hypot(v.vx,v.vz);
  for(const off of [-half,0,half]){const probe={...v,x:v.x+n*off,z:v.z+f*off},prior={x:old.x+n*off,z:old.z+f*off};if(world.confine?.(probe,prior,radius)){v.x=probe.x-n*off;v.z=probe.z-f*off;v.vx=probe.vx;v.vz=probe.vz;v.yawRate=probe.yawRate;impact=Math.max(impact,before-Math.hypot(v.vx,v.vz))}}
  const solids=world.nearSolids?world.nearSolids(v.x,v.z):world.solids;
  for(const o of solids)for(const off of [-half,0,half]){
   const hit=world.contact(o,v.x+n*off,v.z+f*off,radius);if(!hit)continue;
   v.x+=hit.nx*(hit.depth+.005);v.z+=hit.nz*(hit.depth+.005);
   const closing=v.vx*hit.nx+v.vz*hit.nz;if(closing<0){v.vx-=closing*hit.nx*1.08;v.vz-=closing*hit.nz*1.08;impact=Math.max(impact,-closing)}v.yawRate*=.65;
  }
 }
 if(world.limits){const l=world.limits;if(v.x<l.minX||v.x>l.maxX||v.z<l.minZ||v.z>l.maxZ){v.x=Math.max(l.minX,Math.min(l.maxX,v.x));v.z=Math.max(l.minZ,Math.min(l.maxZ,v.z));v.vx=v.vz=0}}
 v.speed=v.vx*Math.sin(v.yaw)+v.vz*Math.cos(v.yaw);return impact;
}
/* Oriented boxes, inverse-mass separation, normal impulse and bounded friction. */
function collideRedlineCars(a,b,ca,cb){
 if(Math.abs((a.y||0)-(b.y||0))>3||Math.hypot(a.x-b.x,a.z-b.z)>(ca.L+cb.L)*.6)return 0;
 const aa=[[Math.cos(a.yaw),-Math.sin(a.yaw)],[Math.sin(a.yaw),Math.cos(a.yaw)]],ba=[[Math.cos(b.yaw),-Math.sin(b.yaw)],[Math.sin(b.yaw),Math.cos(b.yaw)]],ah=[ca.W*.48,ca.L*.48],bh=[cb.W*.48,cb.L*.48];let depth=Infinity,nx=0,nz=0;
 for(const n of [...aa,...ba]){const ra=ah[0]*Math.abs(n[0]*aa[0][0]+n[1]*aa[0][1])+ah[1]*Math.abs(n[0]*aa[1][0]+n[1]*aa[1][1]),rb=bh[0]*Math.abs(n[0]*ba[0][0]+n[1]*ba[0][1])+bh[1]*Math.abs(n[0]*ba[1][0]+n[1]*ba[1][1]),d=(a.x-b.x)*n[0]+(a.z-b.z)*n[1],overlap=ra+rb-Math.abs(d);if(overlap<=0)return 0;if(overlap<depth){depth=overlap;const sign=Math.sign(d)||1;nx=n[0]*sign;nz=n[1]*sign}}
 const ia=1/ca.mass,ib=1/cb.mass,total=ia+ib;a.x+=nx*(depth+.006)*ia/total;a.z+=nz*(depth+.006)*ia/total;b.x-=nx*(depth+.006)*ib/total;b.z-=nz*(depth+.006)*ib/total;
 const relative=(a.vx-b.vx)*nx+(a.vz-b.vz)*nz;if(relative>=0)return 0;
 const impulse=-relative*1.08/total;a.vx+=nx*impulse*ia;a.vz+=nz*impulse*ia;b.vx-=nx*impulse*ib;b.vz-=nz*impulse*ib;
 const tangent=(a.vx-b.vx)*-nz+(a.vz-b.vz)*nx,j=Math.max(-impulse*.12,Math.min(impulse*.12,-tangent/total));a.vx+=-nz*j*ia;a.vz+=nx*j*ia;b.vx-=-nz*j*ib;b.vz-=nx*j*ib;
 a.speed=a.vx*Math.sin(a.yaw)+a.vz*Math.cos(a.yaw);b.speed=b.vx*Math.sin(b.yaw)+b.vz*Math.cos(b.yaw);
 return -relative;
}
if(typeof module!=='undefined'){module.exports=stepRedlineHandling;module.exports.move=moveRedlineVehicle;module.exports.collide=collideRedlineCars;}
