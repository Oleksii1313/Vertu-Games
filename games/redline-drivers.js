/* v6 local driving planner. No coordinate snapping, rubber-band boosts or hidden
   race progress. Route projection measures movement; steering/throttle cause it. */
function createRedlineDrivers({world,at,handling=stepRedlineHandling,move=moveRedlineVehicle}){
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
 const buckets=new Map(),tile=40;
 for(const o of world.solids){for(let x=Math.floor((o.x-o.w-5)/tile);x<=Math.floor((o.x+o.w+5)/tile);x++)for(let z=Math.floor((o.z-o.d-5)/tile);z<=Math.floor((o.z+o.d+5)/tile);z++){const key=x+':'+z;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(o)}}
 world.nearSolids=(x,z)=>[...(buckets.get(Math.floor(x/tile)+':'+Math.floor(z/tile))||[]),...(world.dynamicSolids||[])];
 const stats={decisions:0,laneChanges:0,yields:0,reversals:0,impacts:0};
 function init(a,id,kind){a.y=world.heightAt(a.x,a.z);a.id=id;a.kind=kind;a.vx=Math.sin(a.yaw)*(a.speed||0);a.vz=Math.cos(a.yaw)*(a.speed||0);a.steer=0;a.yawRate=0;a.nitro=100;a.tyres=0;a.baseLane=a.lane||0;a.laneGoal=a.baseLane;a.think=0;a.laneHold=0;a.stuck=0;a.reverse=0;a.behaviour='follow';a.cfg=a.cfg||{engine:0,transmission:0,suspension:0};return a}
 function project(a){
  const points=a.points,ls=a.lengths,closed=a.closed!==false,total=ls.total,ref=a.s||0,s0=closed?(ref%total+total)%total:clamp(ref,0,total-.001);let lo=0,hi=points.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(ls.cum[m]<=s0)lo=m;else hi=m}
  let best=Infinity,result=ref;const count=closed?points.length:points.length-1;
  for(let j=lo-18;j<=lo+18;j++){if(!closed&&(j<0||j>=count))continue;const i=(j%count+count)%count,p=points[i],q=points[(i+1)%points.length],dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz);if(len<.0001)continue;const t=clamp(((a.x-p.x)*dx+(a.z-p.z)*dz)/(len*len),0,1),x=p.x+dx*t,z=p.z+dz*t,d=(a.x-x)**2+(a.z-z)**2;let s=ls.cum[i]+t*len;if(closed)s+=Math.round((ref-s)/total)*total;if(d<best){best=d;result=s}}
  a.s=result;return Math.sqrt(best);
 }
 function point(a,s,lane){const p=at(a.points,a.lengths,s,a.closed!==false);return{...p,x:p.x+Math.cos(p.yaw)*lane,z:p.z-Math.sin(p.yaw)*lane}}
 function staticClear(x,z,r=1.45){return !world.nearSolids(x,z).some(o=>world.contact(o,x,z,r))&&(!world.barrierClear||world.barrierClear(x,z,r))}
 function roadCorridor(a,p){for(let j=1;j<=4;j++){const x=a.x+(p.x-a.x)*j/4,z=a.z+(p.z-a.z)*j/4;if(!staticClear(x,z)||!world.onRoad(x,z))return false}return true}
 function step(a,dt,actors,goal){
  const c=a.model.catalog,route=!!a.points,closed=a.closed!==false;dt=clamp(dt,0,.05);a.y=world.heightAt(a.x,a.z);a.laneHold=Math.max(0,a.laneHold-dt);a.think-=dt;
  if(route)project(a);
  const speed=Math.max(0,a.speed),look=clamp(7+speed*.46,7,25),near=world.nearestRoad(a.x,a.z);
  let base=route?point(a,a.s+look,a.lane||0):goal,desiredSpeed=a.finished?0:(a.cruise||a.vmax||20);
  if(route){let curvature=.0001;for(const d of [8,18,32,50]){const p=point(a,a.s+Math.max(0,d-8),0),q=point(a,a.s+d,0);curvature=Math.max(curvature,Math.abs(angle(q.yaw-p.yaw))/8)}desiredSpeed=Math.min(desiredSpeed,Math.sqrt((a.kind==='traffic'?9:12)/curvature));}
  if(a.think<=0){
   a.think=.12;stats.decisions++;let target=desiredSpeed,state=a.kind==='police'?(a.role||'pursue'):'follow',lane=a.laneGoal;
   const fx=Math.sin(a.yaw),fz=Math.cos(a.yaw),horizon=clamp(10+speed*1.4,16,65);let blocked=false;
   for(const b of actors){if(b===a||Math.abs((b.y||0)-a.y)>3)continue;const dx=b.x-a.x,dz=b.z-a.z;if(dx*dx+dz*dz>horizon*horizon)continue;
    const forward=dx*fx+dz*fz,lateral=Math.abs(dx*fz-dz*fx),bc=b.model?.catalog||b.catalog||c,gap=forward-(c.L+bc.L)/2,heading=Math.cos(b.yaw-a.yaw),otherSpeed=Math.max(0,(b.vx||0)*fx+(b.vz||0)*fz);
    if(forward>0&&lateral<(c.W+bc.W)*.5+.4){const safe=2.3+speed*(a.kind==='traffic'?1.15:.65);if(gap<safe+speed*1.1){target=Math.min(target,Math.max(0,otherSpeed+(gap-safe)*.75));blocked=true;state='brake'}}
    // Predict a crossing conflict, and yield by stable priority rather than random pauses.
    const rvx=(b.vx||0)-a.vx,rvz=(b.vz||0)-a.vz,rv2=rvx*rvx+rvz*rvz,tt=rv2>1?-(dx*rvx+dz*rvz)/rv2:0;
    if(heading<.8&&heading>-.8&&tt>.05&&tt<2.6&&Math.hypot(dx+rvx*tt,dz+rvz*tt)<3.5&&forward>2&&(b.priority??b.id??-1)<(a.priority??a.id)){target=Math.min(target,Math.max(0,(forward-6)*.65));state='yield';stats.yields++}
   }
   if(route){
    const maxLane=near.width/2-c.W/2-1.1,minLane=a.kind==='traffic'&&a.baseLane>0?1.8:-maxLane;
    const candidates=a.laneHold>0?[a.laneGoal]:[a.baseLane,a.baseLane-3.6,a.baseLane+3.6,a.laneGoal],unique=[...new Set(candidates.map(x=>clamp(x,minLane,maxLane)))];let best=null;
    for(const l of unique){let clearance=horizon;for(let s=5;s<=horizon;s+=5){const p=point(a,a.s+s,l);if(!staticClear(p.x,p.z,c.W*.5+.25)){clearance=Math.min(clearance,s-3);break}for(const b of actors){if(b===a||Math.abs((b.y||0)-a.y)>3)continue;const time=s/Math.max(6,speed),pred=Math.min(time,.8),x=b.x+(b.vx||0)*pred,z=b.z+(b.vz||0)*pred;if(Math.hypot(p.x-x,p.z-z)<(c.W+(b.model?.catalog.W||c.W))*.5+1.5)clearance=Math.min(clearance,s-4)}}
     // A lane change also needs a clear side and rear gap; do not jump beside a car.
     if(Math.abs(l-(a.lane||0))>1){const rightX=Math.cos(a.yaw),rightZ=-Math.sin(a.yaw);for(const b of actors){if(b===a)continue;const dx=b.x-a.x,dz=b.z-a.z,along=dx*fx+dz*fz,across=dx*rightX+dz*rightZ;if(along> -10&&along<8&&Math.abs(across-(l-(a.lane||0)))<2.5)clearance=0}}
     const score=clearance-Math.abs(l-a.baseLane)*.7-Math.abs(l-(a.lane||0))*.4;if(!best||score>best.score)best={l,clearance,score};
    }
    if(best){if(Math.abs(best.l-a.laneGoal)>1&&best.clearance>12){lane=best.l;a.laneHold=2.2;stats.laneChanges++;}if(best.clearance<8){target=0;state='blocked'}else if(best.clearance<horizon)target=Math.min(target,Math.sqrt(Math.max(0,2*10*(best.clearance-5))));
     if(blocked&&Math.abs(lane-a.baseLane)>1&&best.clearance>speed*1.2+8){target=desiredSpeed;state='pass'}
    }
   }else if(base){
    // Graph waypoints stay on the road. Local offsets are tested before choosing a bypass.
    const yaw=base.yaw??Math.atan2(base.x-a.x,base.z-a.z),candidates=[0,3.2,-3.2];let chosen=null;
    for(const off of candidates){const p={x:base.x+Math.cos(yaw)*off,z:base.z-Math.sin(yaw)*off};if(roadCorridor(a,p)){chosen=p;break}}
    if(chosen)a.localGoal=chosen;else{a.localGoal=base;target=Math.min(target,4);if(!staticClear(a.x+fx*4,a.z+fz*4))target=0}
   }
   a.laneGoal=lane;a.targetSpeed=Math.max(0,target);a.behaviour=state;
  }
  if(route){a.lane+=(a.laneGoal-a.lane)*(1-Math.exp(-dt*1.8));base=point(a,a.s+look,a.lane)}else base=a.localGoal||base;
  const dx=base.x-a.x,dz=base.z-a.z,distance=Math.hypot(dx,dz),error=angle(Math.atan2(dx,dz)-a.yaw),limit=c.steer/(1+Math.abs(a.speed)*.031);
  const wheel=Math.atan2(2*c.wb*Math.sin(error),Math.max(5,distance))*1.18;
  let steer=Math.abs(error)>1.3?Math.sign(error):Math.sign(wheel)*Math.pow(Math.abs(wheel)/limit,1/1.25),target=Math.min(desiredSpeed,a.targetSpeed??desiredSpeed);
  if(Math.abs(error)>.6)target=Math.min(target,Math.max(3,14/(1+Math.abs(error)*2)));
  let throttle=clamp((target-a.speed)*.65,-1,1);
  if(target<.25&&Math.abs(a.speed)<.5){throttle=0;a.vx*=Math.exp(-dt*20);a.vz*=Math.exp(-dt*20)}
  a.stuck=Math.abs(a.speed)<.8&&(target>2||(a.behaviour==='blocked'&&[2,4,6].some(d=>!staticClear(a.x+Math.sin(a.yaw)*d,a.z+Math.cos(a.yaw)*d))))?a.stuck+dt:Math.max(0,a.stuck-dt*2);
  if(a.stuck>3.5&&a.reverse<=0){const rx=a.x-Math.sin(a.yaw)*5,rz=a.z-Math.cos(a.yaw)*5;if(staticClear(rx,rz)&&!actors.some(b=>b!==a&&Math.hypot(b.x-rx,b.z-rz)<5)){a.reverse=1.25;a.stuck=0;stats.reversals++}}
  if(a.reverse>0){a.reverse-=dt;throttle=a.speed> -3?-0.55:0;steer=-Math.sign(error||1)*.8;a.behaviour='reverse'}
  a.controls={x:clamp(steer,-1,1),y:throttle,brake:false,nitro:a.kind==='racer'&&!a.finished&&a.nitro>25&&Math.abs(error)<.08&&target>29&&a.speed>23&&a.speed<target-2&&a.behaviour==='follow'};
  handling(a,a.controls,c,a.cfg,dt,world.onRoad(a.x,a.z));const hit=move(a,dt,world,c);if(hit>3)stats.impacts++;a.y=world.heightAt(a.x,a.z);if(route)project(a);return hit;
 }
 return{init,step,project,staticClear,roadCorridor,stats};
}
if(typeof module!=='undefined')module.exports=createRedlineDrivers;
