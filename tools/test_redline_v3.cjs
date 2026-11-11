// Node-only regression checks; no browser, network or third-party packages.
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const network=require(path.join(root,'games/redline-roads.js'))();
const step=require(path.join(root,'games/redline-handling.js'));
const sandbox={};vm.createContext(sandbox);const source=fs.readFileSync(path.join(root,'games/redline-cars.js'),'utf8');const catalog=vm.runInContext('('+source.match(/const catalog=(\[[\s\S]*?\n \]);/)[1]+')',sandbox);
const cfg={engine:0,transmission:0,suspension:0};
let metres=0,curved=0,points=0;
for(const r of network.roads){assert(r.total>0&&Number.isFinite(r.total));metres+=r.total;for(const p of r.points){assert(network.onRoad(p.x,p.z));const n=network.nearest(p.x,p.z);assert(n.distance<.01);assert(Number.isFinite(n.yaw));points++;if(Math.abs(Math.sin(n.yaw))>.15&&Math.abs(Math.cos(n.yaw))>.15)curved++}}
assert(network.roads.length>=18); // v3 baseline also accepts additive v4 routes.
assert(curved/points>.65);
for(const race of network.races)for(const p of race.points)assert(network.onRoad(p.x,p.z),'Race left actual road surface');
for(const r of network.roads){const a=network.at(r.id,r.total*.5),b=network.at((r.id+7)%network.roads.length,100),p=network.steerTo({...a,speed:25},b,25);assert(Number.isFinite(p.x)&&network.onRoad(p.x,p.z))}
const fresh=()=>({yaw:0,vx:0,vz:0,steer:0,nitro:100,tyres:0});
for(const c of catalog){const v=fresh();for(let i=0;i<600;i++)step(v,{x:0,y:1},c,cfg,1/60);assert(v.speed>30,c.name+' acceleration');assert(Math.abs(v.yaw)<1e-8);for(let i=0;i<90;i++)step(v,{x:.4,y:1},c,cfg,1/60);assert(v.yaw>.2);for(let i=0;i<90;i++)step(v,{x:0,y:1},c,cfg,1/60);assert(Math.abs(v.steer)<1e-7&&Math.abs(v.yawRate)<1e-4,c.name+' recenter');assert([v.speed,v.yaw,v.vx,v.vz].every(Number.isFinite));for(let i=0;i<360;i++)step(v,{x:0,y:-1},c,cfg,1/60);assert(v.speed<0&&v.speed>=-11);}
const c=catalog[0];
const braking=fresh();braking.vz=100/3.6;let distance=0,seconds=0;while(braking.speed===undefined||braking.speed>.1){step(braking,{x:0,y:-1},c,cfg,1/120);distance+=Math.max(0,braking.speed)/120;seconds+=1/120;assert(seconds<3)}assert(distance<25);
const turn=fresh();turn.vz=100/3.6;for(let i=0;i<60;i++)step(turn,{x:1,y:.3},c,cfg,1/60);assert(turn.yaw>.55,'Arcade turn authority');
for(const dt of [1/30,1/60,1/120]){const v=fresh();for(let t=0;t<5-dt/2;t+=dt)step(v,{x:.15,y:1,nitro:true},c,cfg,dt);assert([v.speed,v.yaw,v.nitro].every(Number.isFinite));assert(v.nitro<100&&v.nitro>=0)}
// Free-roam payouts are one-off and disallowed inside races/prologue.
vm.runInContext(fs.readFileSync(path.join(root,'games/redline-roam.js'),'utf8'),sandbox);
const world={locations:[{id:'service',x:100,z:100},{id:'test',x:0,z:0,name:'Test'}],traps:[{id:'speed',x:60,z:0}],onRoad:()=>true},state={cash:6500},vehicle={x:0,z:0,speed:0};let story={active:true},race=null,saves=0;
const api={world,state,vehicle,stored:null,toast:()=>{},save:()=>saves++,getStory:()=>story,getRace:()=>race};let roam=sandbox.createRedlineRoam(api);roam.update();assert.equal(state.cash,6500);story.active=false;race={};roam.update();assert.equal(state.cash,6500);race=null;roam.update();assert.equal(state.cash,7250);roam.update();assert.equal(state.cash,7250);vehicle.x=60;vehicle.speed=50;roam.update();assert.equal(state.cash,8750);roam.update();assert.equal(state.cash,8750);const stored=JSON.parse(JSON.stringify(state));roam=sandbox.createRedlineRoam({...api,stored});world.traps[0].near=false;roam.update();assert.equal(state.cash,8750);assert.equal(saves,2);
console.log(JSON.stringify({ok:true,roads:network.roads.length,kilometres:+(metres/1000).toFixed(2),nonAxisAlignedPercent:Math.round(curved/points*100),cars:catalog.length,braking100kmh:{metres:+distance.toFixed(1),seconds:+seconds.toFixed(2)},turn100kmhDegrees:+(turn.yaw*180/Math.PI).toFixed(1),oneOffRewards:true},null,2));
