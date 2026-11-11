import * as T from 'three';
// Orbit-style camera with independent gaze elevation: looking up never pushes
// the camera below the ground. One-finger drag, two-finger twist/pinch/pan.
export class RoverCamera {
 constructor({element,worldCamera,kitchenCamera,focus,terrain,solids,enabled,tap}){
  Object.assign(this,{element,worldCamera,kitchenCamera,focus,terrain,solids,enabled,tap});
  this.pointers=new Map();this.two=null;this.context=null;this.anchor=new T.Vector3();this.desired=new T.Vector3();this.direction=new T.Vector3();this.activeCamera=worldCamera;
  this.states={foot:this.makeState(5.7,-.34),vehicle:this.makeState(11,-.34),kitchen:this.makeState(2.95,-.46)};
  element.addEventListener('contextmenu',e=>e.preventDefault());
  element.addEventListener('pointerdown',e=>this.down(e));element.addEventListener('pointermove',e=>this.move(e));
  for(const name of ['pointerup','pointercancel','lostpointercapture'])element.addEventListener(name,e=>this.up(e,name));
  element.addEventListener('wheel',e=>{if(!this.enabled())return;e.preventDefault();const s=this.state();s.distance*=Math.exp(T.MathUtils.clamp(e.deltaY*(e.deltaMode===1?16:1),-250,250)*.0015);this.clamp(s)},{passive:false});
 }
 makeState(distance,pitch){return{yaw:0,pitch,distance,pan:new T.Vector3(),cyaw:0,cpitch:pitch,cdistance:distance,cpan:new T.Vector3()}}
 state(){return this.states[this.focus().context]}
 limits(){const c=this.focus().context;return c==='kitchen'?{min:1.15,max:5.2,pan:1.05,minPitch:-1.30,maxPitch:.83}:c==='vehicle'?{min:4.5,max:20,pan:6,minPitch:-1.30,maxPitch:1.30}:{min:2.7,max:12,pan:3,minPitch:-1.30,maxPitch:1.30}}
 clamp(s){const l=this.limits();s.distance=T.MathUtils.clamp(s.distance,l.min,l.max);s.pitch=T.MathUtils.clamp(s.pitch,l.minPitch,l.maxPitch);const length=Math.hypot(s.pan.x,s.pan.z);if(length>l.pan){s.pan.x*=l.pan/length;s.pan.z*=l.pan/length}s.pan.y=T.MathUtils.clamp(s.pan.y,-.4,this.focus().context==='kitchen'?.65:1.6)}
 down(e){if(!this.enabled()||!['mouse','touch','pen'].includes(e.pointerType)||e.button>2)return;e.preventDefault();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button,type:e.pointerType,moved:0});this.element.setPointerCapture(e.pointerId);this.rebase()}
 rebase(){const ps=[...this.pointers.values()];if(ps.length>=2){const[a,b]=ps;this.two={x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),a:Math.atan2(b.y-a.y,b.x-a.x)};ps.forEach(p=>p.moved=Math.max(20,p.moved))}else this.two=null}
 pan(dx,dy,s){const k=s.distance*.0017;const right=new T.Vector3(Math.cos(s.yaw),0,Math.sin(s.yaw));const up=new T.Vector3(-Math.sin(s.yaw)*Math.sin(s.pitch),Math.cos(s.pitch),Math.cos(s.yaw)*Math.sin(s.pitch));s.pan.addScaledVector(right,-dx*k).addScaledVector(up,dy*k)}
 move(e){const p=this.pointers.get(e.pointerId);if(!p)return;if(!this.enabled()){this.clear();return}e.preventDefault();const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;p.moved+=Math.hypot(dx,dy);const s=this.state(),ps=[...this.pointers.values()];
  if(ps.length>=2){const[a,b]=ps,n={x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),a:Math.atan2(b.y-a.y,b.x-a.x)};if(this.two){s.distance*=this.two.d/n.d;s.yaw+=Math.atan2(Math.sin(n.a-this.two.a),Math.cos(n.a-this.two.a));this.pan(n.x-this.two.x,n.y-this.two.y,s)}this.two=n}
  else if(p.button===2)this.pan(dx,dy,s);
  else if(p.button===1)s.distance*=Math.exp(dy*.008);
  else{s.yaw+=T.MathUtils.clamp(dx,-180,180)*.005;s.pitch-=T.MathUtils.clamp(dy,-180,180)*.0048}
  this.clamp(s);
 }
 up(e,name){const p=this.pointers.get(e.pointerId);if(!p)return;const isTap=name==='pointerup'&&p.button===0&&p.moved<8&&this.pointers.size===1;this.pointers.delete(e.pointerId);try{if(this.element.hasPointerCapture(e.pointerId))this.element.releasePointerCapture(e.pointerId)}catch{}this.rebase();if(isTap&&this.enabled())this.tap?.(e)}
 clear(){for(const[id]of this.pointers){try{if(this.element.hasPointerCapture(id))this.element.releasePointerCapture(id)}catch{}}this.pointers.clear();this.two=null}
 reset(){const f=this.focus(),s=this.state();s.yaw=s.cyaw+Math.atan2(Math.sin((f.context==='kitchen'?0:f.heading)-s.cyaw),Math.cos((f.context==='kitchen'?0:f.heading)-s.cyaw));s.pitch=f.context==='kitchen'?-.46:-.34;s.distance=f.context==='kitchen'?2.95:f.context==='vehicle'?11:5.7;s.pan.set(0,0,0);this.clear()}
 update(dt){const f=this.focus(),s=this.states[f.context],indoor=f.context==='kitchen',cam=indoor?this.kitchenCamera:this.worldCamera;this.clamp(s);
  const changed=this.context!==f.context;if(changed){if(this.context&&this.context!=='kitchen'&&!indoor){const old=this.states[this.context];s.yaw=old.yaw;s.cyaw=old.cyaw;s.cpitch=old.cpitch;s.cdistance=old.cdistance}this.anchor.copy(f.position);this.context=f.context}
  const a=1-Math.exp(-12*dt);s.cyaw+=(s.yaw-s.cyaw)*a;s.cpitch+=(s.pitch-s.cpitch)*a;s.cdistance+=(s.distance-s.cdistance)*a;s.cpan.lerp(s.pan,a);this.anchor.lerp(f.position,1-Math.exp(-18*dt));
  const target=this.anchor.clone().add(s.cpan);if(!indoor){target.x=T.MathUtils.clamp(target.x,-505,505);target.z=T.MathUtils.clamp(target.z,-505,505);target.y=Math.max(target.y,this.terrain(target.x,target.z)+.65)}
  // Gaze pitch may rise to +75 degrees. The orbital position stays above the
  // anchor; look direction, rather than underground motion, reveals the sky.
  const op=Math.min(s.cpitch,-.09),horizontal=s.cdistance*Math.cos(op);
  this.desired.set(target.x-Math.sin(s.cyaw)*horizontal,target.y-Math.sin(op)*s.cdistance,target.z+Math.cos(s.cyaw)*horizontal);
  if(indoor){this.desired.x=T.MathUtils.clamp(this.desired.x,-3.65,3.65);this.desired.z=T.MathUtils.clamp(this.desired.z,-2.75,4.4);this.desired.y=T.MathUtils.clamp(this.desired.y,.42,5.8)}
  else{
   // Sample the sight-line to avoid terrain and buildings. Collision may shorten
   // the *actual* boom without changing the user's bounded zoom setting.
   for(let i=1;i<=14;i++){const f=i/14,p=target.clone().lerp(this.desired,f);let blocked=p.y<this.terrain(p.x,p.z)+.38;if(!blocked)for(const o of this.solids()){if(Math.hypot(p.x-o.x,p.z-o.z)<o.r+.18&&p.y<this.terrain(o.x,o.z)+(o.h||3.5)&&p.y>this.terrain(o.x,o.z)){blocked=true;break}}if(blocked){this.desired.copy(target.clone().lerp(this.desired,Math.max(.13,(i-1)/14)));break}}
   this.desired.x=T.MathUtils.clamp(this.desired.x,-520,520);this.desired.z=T.MathUtils.clamp(this.desired.z,-520,520);this.desired.y=Math.max(this.desired.y,this.terrain(this.desired.x,this.desired.z)+.6);
  }
  if(changed&&this.activeCamera!==cam)cam.position.copy(this.desired);else cam.position.lerp(this.desired,1-Math.exp(-24*dt));
  if(!indoor){cam.position.x=T.MathUtils.clamp(cam.position.x,-520,520);cam.position.z=T.MathUtils.clamp(cam.position.z,-520,520);cam.position.y=Math.max(cam.position.y,this.terrain(cam.position.x,cam.position.z)+.6)}
  this.direction.set(Math.sin(s.cyaw)*Math.cos(s.cpitch),Math.sin(s.cpitch),-Math.cos(s.cyaw)*Math.cos(s.cpitch));cam.lookAt(cam.position.clone().add(this.direction));this.activeCamera=cam;
 }
 snapshot(){const s=this.state(),p=this.activeCamera.position;return{context:this.context,yaw:s.cyaw,pitch:s.cpitch,targetYaw:s.yaw,targetPitch:s.pitch,distance:s.cdistance,targetDistance:s.distance,pan:s.pan.toArray(),position:p.toArray(),direction:this.direction.toArray(),pointers:this.pointers.size}}
}
