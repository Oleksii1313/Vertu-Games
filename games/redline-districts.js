/* v5 occupied parcels. Every placement is tested against roads and existing solids. */
function enrichRedlineDistricts({B,scene,network,surface,cars,architecture,box,cyl,mat,solids,contact,addSolid,safeBuilding,hideouts,rnd}){
 const placements=[],counts={buildings:0,parked:0,people:0,trees:0,plots:surface.lots.length};
 const clear=(x,z,r=2)=>!solids.some(o=>contact(o,x,z,r))&&!hideouts.some(p=>Math.hypot(p.x-x,p.z-z)<22);
 function plantedTree(x,z,scale=1){if(!clear(x,z,3)||network.nearest(x,z).distance<network.nearest(x,z).width/2+4)return;const y=surface.heightAt(x,z),t=architecture.tree(null,x,z,scale);t.position.y=y;counts.trees++;placements.push({kind:'tree',x,z,y})}
 // Infill between the old frontage and a second row of parcels; no buildings on slopes.
 for(const row of [0,1])for(const r of network.roads.filter(r=>!r.mountain))for(let s=65,j=0;s<r.total-45;s+=row?58:35,j++)for(const side of [-1,1]){
  if(counts.buildings>=115)break;const p=network.at(r.id,s);if(p.z>460&&side<0)continue;
  const industrial=p.x< -280,home=p.x>260,kind=industrial?'warehouse':home?'villa':j%4===0?'office':'brick',w=industrial?24:home?14:row?22:14,d=industrial?23:home?12:18,h=industrial?7:home?4.5:kind==='office'?23+(j%3)*4:10+(j%3)*3;
  const off=(r.width/2+d/2+(row?53:9))*side,x=p.x+Math.cos(p.yaw)*off,z=p.z-Math.sin(p.yaw)*off,yaw=p.yaw-side*Math.PI/2;
  if(!safeBuilding(x,z,w,d,yaw)||!clear(x,z,Math.hypot(w,d)/2+5))continue;
  const building=architecture.make({x,z,w,d,h,yaw,kind,variant:j%3});building.position.y=surface.heightAt(x,z);addSolid(x,z,w,d,h+3,yaw);counts.buildings++;placements.push({kind:'building',x,z,y:building.position.y});
  if(!industrial){const wx=x-Math.sin(yaw)*(d/2+3),wz=z-Math.cos(yaw)*(d/2+3);plantedTree(wx,wz,.55)}
 }
 // Occupied interiors of wide city blocks, not just isolated roadside facades.
 for(let x=-590;x<680;x+=67)for(let z=-490;z<480;z+=67){const q=network.nearest(x,z);if(q.distance<48||q.distance>145||q.id>=18)continue;const home=x>200,w=home?14:20,d=home?12:18,yaw=q.yaw+Math.PI/2;
  if(counts.buildings<130&&safeBuilding(x,z,w,d,yaw)&&clear(x,z,Math.hypot(w,d)/2+5)){const b=architecture.make({x,z,w,d,h:home?4.5:13,kind:home?'villa':'brick',yaw,variant:counts.buildings%3});b.position.y=surface.heightAt(x,z);addSolid(x,z,w,d,home?7:15,yaw);counts.buildings++;placements.push({kind:'building',x,z,y:b.position.y});}
  for(let i=0;i<3;i++)plantedTree(x+24+(i%2)*8,z-20+i*9,.72+(i%2)*.22);
 }
 function person(root,x,z,index){const torso=['#566979','#8a6b55','#6f7761','#56625f'][index%4],skin=['#c49574','#9b7055','#cdb194'][index%3],p=new B.TransformNode('Neighbour on the pavement',scene);p.parent=root;p.position.set(x,0,z);p.rotation.y=index*1.71;cyl(p,0,1.12,0,.34,.58,torso);const head=B.MeshBuilder.CreateSphere('Head',{diameter:.23,segments:8},scene);head.parent=p;head.position.set(0,1.57,0);head.material=mat(skin);head.isPickable=false;for(const side of [-1,1]){const leg=cyl(p,side*.09,.46,0,.12,.78,'#414a4f');leg.rotation.x=side*.11;const arm=cyl(p,side*.22,1.12,0,.09,.52,torso);arm.rotation.z=side*.12;box(p,side*.09,.065,.055,.14,.10,.25,'#303a3c',false)}counts.people++;return p;}
 for(const [li,plot]of surface.lots.entries()){
  const root=new B.TransformNode('Occupied parcel / '+plot.kind,scene);root.position.set(plot.x,surface.heightAt(plot.x,plot.z),plot.z);let yaw=plot.yaw;const toRoad=Math.atan2(plot.entry.x-plot.x,plot.entry.z-plot.z);if(Math.cos(toRoad-yaw)<0)yaw+=Math.PI;root.rotation.y=yaw;
  const world=(x,z)=>({x:plot.x+Math.cos(yaw)*x+Math.sin(yaw)*z,z:plot.z-Math.sin(yaw)*x+Math.cos(yaw)*z});
  function plotSign(text,x,y,z,w){architecture.sign(root,text,x,y,z,w);for(const side of [-1,1])cyl(root,x+side*w*.34,y/2,z,.15,y,'#6f7973')}
  function parked(x,z,id,turn=0){const p=world(x,z);if(!clear(p.x,p.z,2.5))return;const car=cars.make(id,{traffic:true,color:['#889592','#a69b86','#526c78','#813e36','#c3c1b4'][counts.parked%5]});car.root.parent=root;car.root.position.set(x,surface.heightAt(p.x,p.z)-root.position.y+.015,z);car.root.rotation.y=turn;addSolid(p.x,p.z,car.catalog.W,car.catalog.L,car.catalog.H,yaw+turn);placements.push({kind:'parked',x:p.x,z:p.z,y:surface.heightAt(p.x,p.z)+.015});counts.parked++;}
  if(plot.kind==='freight'||plot.kind==='harbour'){
   for(let j=0;j<3;j++){const x=-14+j*9,container=box(root,x,1.45,-7,7.6,2.9,3,'#637e7b');for(let k=-5;k<=5;k++)box(root,x+k*.61,1.45,-5.47,.035,2.65,.04,'#405c5e',false);const p=world(x,-7);addSolid(p.x,p.z,7.6,3,2.9,yaw)}
   parked(-12,5,4);parked(0,5,2);parked(12,5,3);
   plotSign(plot.kind==='harbour'?'NORTHPORT FREIGHT':'WAREHOUSE / 24H',0,4.3,-11,20);
  }else if(plot.kind==='cafe'||plot.kind==='market'){
   const shop=architecture.make({x:0,z:-8,w:18,d:9,h:5.2,kind:'brick',variant:li%3,parent:root,label:plot.kind==='cafe'?'CEDAR COFFEE':'MONROE MARKET'});const wp=world(0,-8);addSolid(wp.x,wp.z,18,9,6.3,yaw);
   for(const side of [-1,1]){cyl(root,side*7,.43,3,.14,.86,'#59655c');cyl(root,side*7,.9,3,2.0,.09,'#9d8a6a');const parasol=B.MeshBuilder.CreateCylinder('Cafe parasol',{diameterTop:.1,diameterBottom:3.5,height:.6,tessellation:12},scene);parasol.parent=root;parasol.position.set(side*7,2.8,3);parasol.material=mat(li%2?'#b8a57e':'#62857c');parasol.isPickable=false;cyl(root,side*7,1.4,3,.055,2.8,'#78796a');person(root,side*7+1.4,4,li+side);for(const dx of [-1.2,1.2])box(root,side*7+dx,.43,3,.55,.07,.55,'#716952',false)}parked(-18,6,0);parked(18,6,1,Math.PI);
  }else{
   for(const row of [-1,1])for(let j=-4;j<=4;j++){const x=j*4;box(root,x,.018,row*7,.09,.014,6,'#d5d3ba',false);if(j<4&&(j+li+(row>0?1:0))%3!==0)parked(x+2,row*7,[0,1,2,4,7][(j+4+li)%5],row>0?Math.PI:0)}
   plotSign(plot.kind==='service'?'MIRA / PARKING & PARTS':'P / NORTHPORT',0,4.8,-13,17);person(root,-19,-5,li);
  }
  for(const side of [-1,1]){const p=world(side*21,-12);plantedTree(p.x,p.z,.8);cyl(root,side*21,3.5,11,.15,7,'#6f7973');box(root,side*21,6.9,10.5,1.1,.1,.8,'#c6cabd',false)}
 }
 // Trees and neighbours populate the actual sidewalk, never the carriageway.
 for(const r of network.roads.filter(r=>!r.mountain))for(let s=32,j=0;s<r.total-20;s+=44,j++){
  const p=network.at(r.id,s);for(const side of [-1,1]){const off=r.width/2+2.4,x=p.x+Math.cos(p.yaw)*off*side,z=p.z-Math.sin(p.yaw)*off*side;if(!clear(x,z,1)||network.nearest(x,z).distance<r.width/2+1)continue;if((j+r.id)%4===0&&counts.people<50){const root=new B.TransformNode('Pavement pedestrian',scene);root.position.set(x,surface.heightAt(x,z),z);root.rotation.y=p.yaw;person(root,0,0,j+r.id);placements.push({kind:'person',x,z,y:root.position.y})}
   if((j+r.id)%3===0){const tx=p.x+Math.cos(p.yaw)*(r.width/2+7)*side,tz=p.z-Math.sin(p.yaw)*(r.width/2+7)*side;plantedTree(tx,tz,.68+(j%3)*.12)}}
 }
 return{detailStats:counts,placements};
}
