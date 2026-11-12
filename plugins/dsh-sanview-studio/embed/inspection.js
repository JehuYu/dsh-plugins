'use strict';
// Optional, local geometric constraint analysis. Never modifies the drawing.
(function(root){
const D=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.Draft;
const TOL=.015,EPS=1e-8,roles=['auto','single','front','top','side','ignore'];
const near=(a,b)=>Math.abs(a-b)<TOL,pointKey=p=>Math.round(p.x/TOL)+','+Math.round(p.y/TOL);
const expr=(...terms)=>{const row=new Map();for(const [i,n] of terms)if(i!=null)row.set(i,(row.get(i)||0)+n);for(const [i,n] of row)if(Math.abs(n)<1e-11)row.delete(i);return row;};
function combine(...terms){const out=new Map();for(const [row,k] of terms)for(const [i,n] of row||[])out.set(i,(out.get(i)||0)+n*k);for(const [i,n] of out)if(Math.abs(n)<1e-10)out.delete(i);return out;}
class Basis{
 constructor(source){this.rows=new Map(source?[...source.rows].map(([i,b])=>[i,{row:new Map(b.row),proof:new Map(b.proof)}]):[]);}
 reduce(input,proof=new Map()){
  const row=new Map(input),p=new Map(proof),norm=Math.max(0,...[...row.values()].map(Math.abs));if(norm)for(const [i,n] of row)row.set(i,n/norm);if(norm)for(const [i,n] of p)p.set(i,n/norm);
  for(const [i,b] of [...this.rows].sort((a,b)=>a[0]-b[0])){const k=row.get(i)||0;if(Math.abs(k)<EPS){row.delete(i);continue;}for(const [j,n] of b.row){const v=(row.get(j)||0)-k*n;if(Math.abs(v)<EPS)row.delete(j);else row.set(j,v);}for(const [id,n] of b.proof){const v=(p.get(id)||0)-k*n;if(Math.abs(v)<EPS)p.delete(id);else p.set(id,v);}}
  return {row,proof:p};
 }
 add(input,id){const out=this.reduce(input,id?new Map([[id,1]]):new Map());if(!out.row.size)return {added:false,ids:[...out.proof.keys()]};const pivot=Math.min(...out.row.keys()),k=out.row.get(pivot);for(const [i,n] of out.row)out.row.set(i,n/k);for(const [i,n] of out.proof)out.proof.set(i,n/k);this.rows.set(pivot,out);return {added:true,ids:[]};}
 get rank(){return this.rows.size;}
}
function bounds(o){let points=D.anchors(o);if(o.type==='arc'){const a=D.arcGeometry(o);if(a){const start=Math.atan2(a.p1.y-a.c.y,a.p1.x-a.c.x),end=Math.atan2(a.p3.y-a.c.y,a.p3.x-a.c.x),norm=t=>(t%(2*Math.PI)+2*Math.PI)%(2*Math.PI),span=a.sweep?norm(end-start):norm(start-end);points=[a.p1,a.p3];for(const t of [0,Math.PI/2,Math.PI,Math.PI*1.5])if((a.sweep?norm(t-start):norm(start-t))<=span+1e-7)points.push(D.add(a.c,D.pt(Math.cos(t)*a.r,Math.sin(t)*a.r)));}}
 if(!points.length)return null;return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))};}
const union=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),right:Math.max(a.right,b.right),bottom:Math.max(a.bottom,b.bottom)});
const overlap=(a,b)=>a.x<=b.right+TOL&&a.right+TOL>=b.x&&a.y<=b.bottom+TOL&&a.bottom+TOL>=b.y;
function hash(ids){let h=2166136261;for(const c of ids.slice().sort().join('|')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function viewsFor(objects,options={}){
 const geometry=objects.filter(o=>!['dim','text'].includes(o.type)&&!['thin','center'].includes(o.style)),used=new Set(),groups=[];
 for(const manual of options.groups||[]){const members=geometry.filter(o=>manual.ids?.includes(o.id));if(!members.length)continue;members.forEach(o=>used.add(o.id));groups.push({id:manual.id,objects:members,manual:true});}
 // Imported projections retain their correspondence after independent rigid moves.
 if(!options.onlyManual){const projected=new Map();for(const o of geometry)if(o.viewGroup&&!used.has(o.id)){if(!projected.has(o.viewGroup))projected.set(o.viewGroup,[]);projected.get(o.viewGroup).push(o);}for(const [id,members] of projected){members.forEach(o=>used.add(o.id));groups.push({id,objects:members});}}
 const clusters=(options.onlyManual?[]:geometry.filter(o=>!used.has(o.id))).map(o=>({objects:[o],box:bounds(o)})).filter(g=>g.box);
 let changed=true;while(changed){changed=false;outer:for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++)if(overlap(clusters[i].box,clusters[j].box)){clusters[i].objects.push(...clusters[j].objects);clusters[i].box=union(clusters[i].box,clusters[j].box);clusters.splice(j,1);changed=true;break outer;}}
 for(const g of clusters)groups.push({id:'auto-'+hash(g.objects.map(o=>o.id)),objects:g.objects});
 groups.forEach(g=>{g.box=g.objects.map(bounds).filter(Boolean).reduce(union);g.w=g.box.right-g.box.x;g.h=g.box.bottom-g.box.y;const role=g.objects[0]?.projectionRole;g.role=g.objects.every(o=>o.projectionRole===role)&&['front','top','side','iso'].includes(role)?role==='iso'?'ignore':role:'single';});groups.sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x);
 // Infer familiar orthographic layout, but preserve independent editing and positions.
 if(groups.length>1&&groups.length<=3&&groups.every(g=>g.role==='single')){const front=groups.slice().sort((a,b)=>(a.box.x+a.box.y)-(b.box.x+b.box.y))[0];front.role='front';for(const g of groups.filter(g=>g!==front)){const below=g.box.y>=front.box.bottom-TOL,right=g.box.x>=front.box.right-TOL;if(below&&Math.abs(g.w-front.w)<.1)g.role='top';else if(right&&Math.abs(g.h-front.h)<.1)g.role='side';}}
 for(const g of groups){const config=options.views?.[g.id]||{};if(roles.includes(config.role)&&config.role!=='auto')g.role=config.role;g.flipX=!!config.flipX;g.flipY=!!config.flipY;g.label='视图 '+(groups.indexOf(g)+1);}
 return groups;
}
class Model{
 constructor(){this.variables=[];this.points=[];this.pointMap=new Map();this.edges=[];this.features=[];this.rows=[];this.owners=new Map();this.pending=[];this.candidates=[];this.centerLines=[];}
 variable(value){const i=this.variables.length;this.variables.push(value);return i;}
 point(p,view,owner){const key=view.id+':'+pointKey(p);let found=this.pointMap.get(key);if(!found){found={p:{...p},x:this.variable(p.x),y:this.variable(p.y),view,owners:new Set()};this.pointMap.set(key,found);this.points.push(found);}if(owner)found.owners.add(owner);return found;}
 add(row){if(row.size)this.rows.push(row);}
 edge(a,b,view,owner){const A=this.point(a,view,owner),B=this.point(b,view,owner);if(D.dist(a,b)<TOL)return;const edge={A,B,view,owner};this.edges.push(edge);if(near(a.x,b.x))this.add(expr([A.x,1],[B.x,-1]));if(near(a.y,b.y))this.add(expr([A.y,1],[B.y,-1]));}
 curve(c,r,view,owner,arc){const C=this.point(c,view,owner),R=this.variable(r),feature={C,R,r,view,owner,arc};this.features.push(feature);if(arc){feature.ends=[arc.p1,arc.p3].map(p=>this.point(p,view,owner));for(const P of feature.ends){const v=D.unit(D.sub(P.p,c));this.add(expr([P.x,v.x],[P.y,v.y],[C.x,-v.x],[C.y,-v.y],[R,-1]));}
   const [A,B]=feature.ends,u=D.sub(A.p,c),v=D.sub(B.p,c),dot=u.x*v.x+u.y*v.y;
   if(D.dist(D.add(u,v),D.pt(0,0))<TOL){this.add(expr([A.x,1],[B.x,1],[C.x,-2]));this.add(expr([A.y,1],[B.y,1],[C.y,-2]));}
   else if(Math.abs(dot)<TOL*r){this.add(expr([A.x,v.x],[A.y,v.y],[B.x,u.x],[B.y,u.y],[C.x,-u.x-v.x],[C.y,-u.y-v.y]));}
  }return feature;}
 issue(text,ids=[],view){this.pending.push({text,ids,viewId:view?.id});}
 candidate(row,label,value,ids,view){this.candidates.push({row,label,value,ids,viewId:view?.id});}
}
function populate(model,view,allObjects=[]){
 for(const o of view.objects){model.owners.set(o.id,view);
  if(o.type==='line'&&o.style==='center'){model.centerLines.push({axis:o,view});continue;}
  if(o.type==='circle')model.curve(o.c,o.r,view,o.id);
  else if(o.type==='arc'){const a=D.arcGeometry(o);if(a)model.curve(a.c,a.r,view,o.id,a);else model.issue('圆弧几何无法识别',[o.id],view);}
  else if(o.type==='profile'&&['slot','roundrect','hexagon'].includes(o.profile))profile(model,view,o);
  else{for(const s of D.segments(o))model.edge(...s,view,o.id);if(o.type==='profile'&&o.profile==='trapezoid'){const p=D.profileGeometry(o).anchors.slice(0,4).map(p=>model.point(p,view,o.id));model.add(expr([p[0].x,1],[p[1].x,1],[p[2].x,-1],[p[3].x,-1]));}
   if(o.type==='path'&&o.segments.some(s=>!['M','L','Z'].includes(s.cmd)))model.issue('SVG 曲线尚需人工确认，当前计数仅覆盖可识别部分',[o.id],view);
  }
 }
 for(const o of allObjects)if(o.type==='line'&&o.style==='center'&&axisNearView(o,view)&&!model.centerLines.some(item=>item.axis===o&&item.view===view))model.centerLines.push({axis:o,view});
 // Connections to the middle of a straight edge, including hidden edges.
 const points=model.points.filter(p=>p.view===view),edges=model.edges.filter(e=>e.view===view);
 for(const P of points)for(const {A,B} of edges){if(P===A||P===B)continue;const v=D.sub(B.p,A.p),q=D.projectToLine(P.p,[A.p,B.p]),t=((P.p.x-A.p.x)*v.x+(P.p.y-A.p.y)*v.y)/(v.x*v.x+v.y*v.y);if(t<0||t>1||D.dist(P.p,q)>TOL)continue;model.add(expr([P.x,-v.y],[P.y,v.x],[A.x,v.y*(1-t)],[A.y,-v.x*(1-t)],[B.x,v.y*t],[B.y,-v.x*t]));}
 for(const P of points){const adjacent=edges.filter(e=>e.A===P||e.B===P).map(e=>e.A===P?e.B:e.A);for(let i=0;i<adjacent.length;i++)for(let j=i+1;j<adjacent.length;j++){const A=adjacent[i],B=adjacent[j],u=D.sub(A.p,P.p),v=D.sub(B.p,P.p);if(Math.abs(u.x*v.x+u.y*v.y)<1e-6*D.len(u)*D.len(v))model.add(expr([A.x,v.x],[A.y,v.y],[B.x,u.x],[B.y,u.y],[P.x,-u.x-v.x],[P.y,-u.y-v.y]));}
  if(adjacent.length===2&&!model.features.some(f=>f.C===P||f.ends?.includes(P))){const [A,B]=adjacent,u=D.sub(A.p,P.p),v=D.sub(B.p,P.p),delta=D.sub(B.p,A.p);if(u.x*v.x+u.y*v.y<0&&Math.abs(u.x*v.y-u.y*v.x)<1e-6*D.len(u)*D.len(v)){const t=D.dist(A.p,P.p)/D.dist(A.p,B.p);P.construction=true;model.add(expr([P.x,1],[A.x,t-1],[B.x,-t]));model.add(expr([P.y,1],[A.y,t-1],[B.y,-t]));}}}
 for(const f of model.features.filter(f=>f.view===view&&f.ends))for(const P of f.ends)for(const {A,B} of edges){const O=P===A?B:P===B?A:null;if(!O)continue;const u=D.sub(P.p,f.C.p),v=D.sub(O.p,P.p);if(Math.abs(u.x*v.x+u.y*v.y)>TOL*f.r)continue;model.add(expr([P.x,v.x-u.x],[P.y,v.y-u.y],[f.C.x,-v.x],[f.C.y,-v.y],[O.x,u.x],[O.y,u.y]));}
}
function profile(m,v,o){
 const x=Math.min(o.p1.x,o.p2.x),y=Math.min(o.p1.y,o.p2.y),w=Math.abs(o.p2.x-o.p1.x),h=Math.abs(o.p2.y-o.p1.y),c=D.pt(x+w/2,y+h/2);
 if(o.profile==='hexagon'){const r=Math.min(w/2,h/Math.sqrt(3)),C=m.point(c,v,o.id),R=m.variable(r);for(const p of D.profileGeometry(o).anchors.slice(0,6)){const P=m.point(p,v,o.id);m.add(expr([P.x,1],[C.x,-1],[R,-(p.x-c.x)/r]));m.add(expr([P.y,1],[C.y,-1],[R,-(p.y-c.y)/r]));}for(const s of D.profileGeometry(o).segments)m.edge(...s,v,o.id);m.candidate(expr([R,1]),'正六边形边长',r,[o.id],v);return;}
 const r=o.profile==='slot'?Math.min(w,h)/2:Math.min(o.radius||5,w/2,h/2),C=m.point(c,v,o.id),W=m.variable(w),H=m.variable(h),R=m.variable(r);
 if(o.profile==='slot')m.add(expr([R,2],[w>=h?H:W,-1]));
 const source=D.profileGeometry(o);for(const p of source.anchors){const P=m.point(p,v,o.id);let ax=(p.x-c.x)/(w/2||1),ay=(p.y-c.y)/(h/2||1),rx=0,ry=0;
  if(near(Math.abs(p.x-c.x),w/2-r)&&!near(p.x,c.x)){ax=Math.sign(p.x-c.x);rx=-Math.sign(p.x-c.x);}if(near(Math.abs(p.y-c.y),h/2-r)&&!near(p.y,c.y)){ay=Math.sign(p.y-c.y);ry=-Math.sign(p.y-c.y);}
  m.add(expr([P.x,1],[C.x,-1],[W,-ax/2],[R,-rx]));m.add(expr([P.y,1],[C.y,-1],[H,-ay/2],[R,-ry]));
 }
 for(const s of source.segments)m.edge(...s,v,o.id);m.candidate(expr([R,1]),o.profile==='slot'?'腰孔端部半径':'圆角半径',r,[o.id],v);
 const addArc=(cx,cy,ax,ay,rx,ry,start,sweep)=>{const a=D.arcGeometry({c:D.pt(cx,cy),r,startAngle:start,sweepAngle:sweep}),f=m.curve(a.c,r,v,o.id,a);m.add(expr([f.R,1],[R,-1]));m.add(expr([f.C.x,1],[C.x,-1],[W,-ax/2],[R,-rx]));m.add(expr([f.C.y,1],[C.y,-1],[H,-ay/2],[R,-ry]));};
 if(o.profile==='slot'){if(w>=h){addArc(x+r,c.y,-1,0,1,0,90,180);addArc(x+w-r,c.y,1,0,-1,0,-90,180);}else{addArc(c.x,y+r,0,-1,0,1,180,180);addArc(c.x,y+h-r,0,1,0,-1,0,180);}}
 else{addArc(x+r,y+r,-1,-1,1,1,180,90);addArc(x+w-r,y+r,1,-1,-1,1,-90,90);addArc(x+w-r,y+h-r,1,1,-1,-1,0,90);addArc(x+r,y+h-r,-1,1,1,-1,90,90);}
}
function axisNearView(axis,view){const b=view.box,a={x:Math.min(axis.p1.x,axis.p2.x),y:Math.min(axis.p1.y,axis.p2.y),right:Math.max(axis.p1.x,axis.p2.x),bottom:Math.max(axis.p1.y,axis.p2.y)};return a.x<=b.right+TOL&&a.right+TOL>=b.x&&a.y<=b.bottom+TOL&&a.bottom+TOL>=b.y;}
function axisCoversShape(axis,objects){
 const contour=objects.filter(o=>o.type!=='dim'&&o.type!=='text'&&!(o.type==='line'&&o.style==='center')),pts=contour.flatMap(o=>D.anchors(o));if(pts.length<2)return false;
 const vertical=Math.abs(axis.p1.x-axis.p2.x)<TOL,horizontal=Math.abs(axis.p1.y-axis.p2.y)<TOL;if(!vertical&&!horizontal)return false;
 const key=vertical?'y':'x',lo=Math.min(...pts.map(p=>p[key])),hi=Math.max(...pts.map(p=>p[key])),a=Math.min(axis.p1[key],axis.p2[key]),b=Math.max(axis.p1[key],axis.p2[key]),span=hi-lo;
 return span>TOL&&a<=lo+TOL&&b>=hi-TOL;
}
function symmetry(m,view,objects){
 const points=m.points.filter(p=>p.view===view),edges=m.edges.filter(e=>e.view===view),features=m.features.filter(f=>f.view===view);
 for(const axis of objects.filter(o=>o.type==='line'&&o.style==='center'&&axisNearView(o,view))){
  const vertical=Math.abs(axis.p1.x-axis.p2.x)<TOL,horizontal=Math.abs(axis.p1.y-axis.p2.y)<TOL;if(!vertical&&!horizontal)continue;
  const key=vertical?'x':'y',other=vertical?'y':'x',at=(axis.p1[key]+axis.p2[key])/2,full=axisCoversShape(axis,view.objects),axisVar=m.variable(at);
  const contentPoints=points.filter(p=>!p.owners.has(axis.id)),contentEdges=edges.filter(e=>e.owner!==axis.id),contentFeatures=features.filter(f=>f.owner!==axis.id),reflect=p=>({...p,[key]:2*at-p[key]}),find=p=>contentPoints.find(q=>D.dist(q.p,p)<TOL);
  for(const f of contentFeatures)if(near(f.C.p[key],at))m.add(expr([f.C[key],1],[axisVar,-1]));
  if(!full){if(!m.rows.some(row=>row.has(axisVar)))m.add(expr([axisVar,1]));continue;}
  const mirrored=contentPoints.every(P=>!!find(reflect(P.p)))&&contentEdges.every(e=>contentEdges.some(q=>D.dist(q.A.p,reflect(e.A.p))<TOL&&D.dist(q.B.p,reflect(e.B.p))<TOL||D.dist(q.B.p,reflect(e.A.p))<TOL&&D.dist(q.A.p,reflect(e.B.p))<TOL))&&contentFeatures.every(f=>contentFeatures.some(g=>near(g.r,f.r)&&D.dist(g.C.p,reflect(f.C.p))<TOL));
  if(!mirrored){if(!m.rows.some(row=>row.has(axisVar)))m.add(expr([axisVar,1]));continue;}
  const seen=new Set();
  for(const P of contentPoints){if(seen.has(P))continue;const Q=find(reflect(P.p));if(!Q)continue;seen.add(P);seen.add(Q);if(P===Q||D.dist(P.p,Q.p)<TOL)m.add(expr([P[key],1],[axisVar,-1]));else{m.add(expr([P[other],1],[Q[other],-1]));m.add(expr([P[key],1],[Q[key],1],[axisVar,-2]));}}
  for(const f of contentFeatures){const g=contentFeatures.find(g=>near(g.r,f.r)&&D.dist(g.C.p,reflect(f.C.p))<TOL);if(g&&g!==f)m.add(expr([f.R,1],[g.R,-1]));}
  if(!m.rows.some(row=>row.has(axisVar)))m.add(expr([axisVar,1]));
 }
}
function onArc(f,angle){if(!f.arc)return true;const norm=a=>(a%(2*Math.PI)+2*Math.PI)%(2*Math.PI),start=Math.atan2(f.arc.p1.y-f.C.p.y,f.arc.p1.x-f.C.p.x),end=Math.atan2(f.arc.p3.y-f.C.p.y,f.arc.p3.x-f.C.p.x);return(f.arc.sweep?norm(angle-start):norm(start-angle))<=(f.arc.sweep?norm(end-start):norm(start-end))+1e-7;}
function axisItems(m,v,key){const items=m.points.filter(p=>p.view===v&&!p.construction).map(p=>({value:p.p[key],row:expr([p[key],1]),ids:[...p.owners]}));for(const f of m.features.filter(f=>f.view===v))for(const sign of [-1,1]){const angle=key==='x'?(sign>0?0:Math.PI):(sign>0?Math.PI/2:-Math.PI/2),value=f.C.p[key]+sign*f.r;if(onArc(f,angle)&&value>=(key==='x'?v.box.x:v.box.y)-TOL&&value<=(key==='x'?v.box.right:v.box.bottom)+TOL)items.push({value,row:expr([f.C[key],1],[f.R,sign]),ids:[f.owner]});}return items;}
function axisFrame(m,v,key){const low=key==='x'?v.box.x:v.box.y,high=key==='x'?v.box.right:v.box.bottom,items=axisItems(m,v,key).filter(i=>i.value>=low-TOL&&i.value<=high+TOL);if(!items.length)return null;const lo=Math.min(...items.map(i=>i.value)),hi=Math.max(...items.map(i=>i.value)),base=items.find(i=>near(i.value,lo)),last=items.find(i=>near(i.value,hi));return {items,lo,hi,span:hi-lo,base,last};}
function expressionKey(basis,row){const reduced=basis.reduce(row).row;return [...reduced].sort((a,b)=>a[0]-b[0]).map(([i,n])=>i+':'+Math.round(n*1e7)).join(',');}
function linkProjection(m,views,basis,options){
 const families={X:[],Y:[],Z:[]};for(const v of views){const map=v.role==='front'?['X','Z']:v.role==='top'?['X','Y']:v.role==='side'?['Y','Z']:[];map.forEach((family,i)=>{const key=i?'y':'x',frame=axisFrame(m,v,key);if(frame)families[family].push({v,key,frame,flip:i?v.flipY:v.flipX});});}
 for(const [family,frames] of Object.entries(families))for(let i=1;i<frames.length;i++){
  const a=frames[0],b=frames[i];if(Math.abs(a.frame.span-b.frame.span)>.1){m.issue(`${a.v.label}与${b.v.label}的${{X:'长',Y:'宽',Z:'高'}[family]}投影不一致，请确认视图对应`,[...a.v.objects,...b.v.objects].map(o=>o.id));continue;}
  const normalized=f=>{const buckets=[];for(const item of f.frame.items){const value=f.flip?f.frame.hi-item.value:item.value-f.frame.lo,row=combine([item.row,f.flip?-1:1],[(f.flip?f.frame.last:f.frame.base).row,f.flip?1:-1]);let bucket=buckets.find(t=>near(t.value,value));if(!bucket){bucket={value,rows:new Map(),ids:[]};buckets.push(bucket);}bucket.rows.set(expressionKey(basis,row),row);bucket.ids.push(...item.ids);}return buckets;};
  const A=normalized(a),B=normalized(b);let ambiguous=false;
  for(const p of A){const q=B.find(q=>near(q.value,p.value));if(!q)continue;if(p.rows.size!==1||q.rows.size!==1){ambiguous=true;continue;}const row=combine([[...p.rows.values()][0],1],[[...q.rows.values()][0],-1]);m.add(row);basis.add(row);}
  if(ambiguous)m.issue(`${a.v.label}与${b.v.label}存在重合投影，无法唯一识别同一特征，请确认`,[]);
  if(family==='Y'&&a.frame.items.some(p=>p.value>a.frame.lo+TOL&&p.value<a.frame.hi-TOL)&&!options.depthConfirmed)m.issue('俯、侧视图的宽方向及内部特征对应需要确认；可调整翻转后确认对应',[]);
 }
}
function coordinate(m,v,p,key){const exact=m.points.find(q=>q.view===v&&D.dist(q.p,p)<TOL);if(exact)return exact.construction?null:expr([exact[key],1]);
 for(const {axis} of m.centerLines.filter(item=>item.view===v)){const vertical=Math.abs(axis.p1.x-axis.p2.x)<TOL,horizontal=Math.abs(axis.p1.y-axis.p2.y)<TOL,at=vertical?axis.p1.x:horizontal?axis.p1.y:null;if(at==null||Math.abs(p[key]-at)>=TOL)continue;const feature=m.features.find(f=>f.view===v&&near(f.C.p[key],at));if(feature)return expr([feature.C[key],1]);}
 for(const f of m.features.filter(f=>f.view===v)){if(D.dist(f.C.p,p)<TOL)return expr([f.C[key],1]);const delta=D.sub(p,f.C.p);if(Math.abs(D.len(delta)-f.r)<TOL){const u=D.unit(delta);return expr([f.C[key],1],[f.R,u[key]]);}}
 for(const {A,B,view} of m.edges){if(view!==v)continue;const q=D.projectToLine(p,[A.p,B.p]);if(D.dist(q,p)>TOL)continue;const delta=D.sub(B.p,A.p),t=((p.x-A.p.x)*delta.x+(p.y-A.p.y)*delta.y)/(delta.x*delta.x+delta.y*delta.y);if(t<-.001||t>1.001)continue;return expr([A[key],1-t],[B[key],t]);}return null;}
function dimensionRow(m,d,objects){
 if(['radius','diameter','arcLength','chordLength'].includes(d.kind)){
  let fs=m.features.filter(f=>f.owner===d.circleId);if(fs.length>1)fs=fs.filter(f=>D.dist(f.C.p,d.c)<TOL);if(!fs.length)fs=m.features.filter(f=>D.dist(f.C.p,d.c)<TOL&&near(f.r,d.r));if(fs.length!==1)return null;
  // 弧长 = R·θ、弦长 = 2R·sin(θ/2) 也都是半径的一次函数，与 θ 无关地参与同一套约束计数
  const sweep=d.kind==='arcLength'||d.kind==='chordLength'?Math.abs(Number.isFinite(d.arcSweep)?d.arcSweep:0):0;
  const factor=d.kind==='diameter'?2:d.kind==='arcLength'?sweep*Math.PI/180:d.kind==='chordLength'?2*Math.sin(sweep*Math.PI/360):1;
  return {view:fs[0].view,row:expr([fs[0].R,factor||1]),ids:[fs[0].owner]};
 }
 const refs=[d.ref1?.id,d.ref2?.id,...D.measurementRefs(d.measurement).map(r=>r.id)].filter(Boolean),referenced=[...new Set(refs.map(id=>m.owners.get(id)).filter(Boolean))];let possible=referenced.length?referenced:m.views.filter(v=>[d.p1,d.p2,d.c].filter(Boolean).every(p=>p.x>=v.box.x-TOL&&p.x<=v.box.right+TOL&&p.y>=v.box.y-TOL&&p.y<=v.box.bottom+TOL));if(possible.length!==1)return null;const view=possible[0];
 const get=(p,key)=>coordinate(m,view,p,key);let row;
 if(d.kind==='angle'&&d.measurement?.mode==='line-angle'){const vectors=[];for(const ref of [d.measurement.line1,d.measurement.line2]){const source=objects.find(o=>o.id===ref.id),part=source&&D.geometryPart(source,ref.partIndex??ref.index);if(part?.type!=='line')return null;const a=D.add(part.p1,ref.offset||D.pt(0,0)),b=D.add(part.p2,ref.offset||D.pt(0,0)),v=D.sub(b,a),n=v.x*v.x+v.y*v.y;if(n<1e-8)return null;const rows=[get(a,'x'),get(a,'y'),get(b,'x'),get(b,'y')];if(rows.some(r=>!r))return null;vectors.push(combine([rows[0],v.y/n],[rows[1],-v.x/n],[rows[2],-v.y/n],[rows[3],v.x/n]));}row=combine([vectors[0],-1],[vectors[1],1]);}
 else if(d.kind==='angle'){const u=D.sub(d.p1,d.c),v=D.sub(d.p2,d.c),u2=u.x*u.x+u.y*u.y,v2=v.x*v.x+v.y*v.y;if(u2<1e-7||v2<1e-7)return null;const px=get(d.p1,'x'),py=get(d.p1,'y'),qx=get(d.p2,'x'),qy=get(d.p2,'y'),cx=get(d.c,'x'),cy=get(d.c,'y');if([px,py,qx,qy,cx,cy].some(r=>!r))return null;row=combine([px,u.y/u2],[py,-u.x/u2],[qx,-v.y/v2],[qy,v.x/v2],[cx,-u.y/u2+v.y/v2],[cy,u.x/u2-v.x/v2]);}
 else{const u=d.kind==='horizontal'?D.pt(1,0):d.kind==='vertical'?D.pt(0,1):D.unit(D.sub(d.p2,d.p1)),px=get(d.p1,'x'),py=get(d.p1,'y'),qx=get(d.p2,'x'),qy=get(d.p2,'y');if((u.x&&(!px||!qx))||(u.y&&(!py||!qy)))return null;row=combine([qx,u.x],[px,-u.x],[qy,u.y],[py,-u.y]);}
 return {view,row,ids:refs};
}
function inspect(objects,options={}){
 const groups=viewsFor(objects,options),views=groups.filter(v=>v.role!=='ignore'),m=new Model();m.views=views;const out={views:groups.map(v=>({id:v.id,label:v.label,role:v.role,manual:v.manual,ids:v.objects.map(o=>o.id),box:v.box,flipX:v.flipX,flipY:v.flipY})),missing:0,extra:0,missingItems:[],extraItems:[],pending:[],dimensions:[],assumptions:['按绘图中明确的水平、垂直、相接、相切、同心和中心线关系推定；不校验数字或注法正误。']};
 if(!views.length){out.missing=null;out.extra=null;out.pending=[{text:'当前没有可检查的轮廓图形，请绘图、导入或调整检查范围',ids:[]}];return out;}
 const geometry=views.flatMap(v=>v.objects),cost=geometry.reduce((n,o)=>n+(o.points?.length||o.segments?.length*2||(o.type==='profile'?20:o.type==='circle'?1:4)),0);
 if(geometry.length>300||cost>320){out.missing=null;out.extra=null;out.pending=[{text:'图形较复杂，请框选所需图形作为检查视图，或分图检查',ids:[]}];return out;}
 for(const v of views)populate(m,v,objects);if(m.variables.length>800){out.missing=null;out.extra=null;out.pending=[{text:'约束数量超出即时检查范围，请缩小检查范围',ids:[]}];return out;}
 for(const v of views)symmetry(m,v,objects);
 const basis=new Basis();m.rows.forEach(r=>basis.add(r));
 for(const v of views){const X=axisFrame(m,v,'x'),Y=axisFrame(m,v,'y');if(!X||!Y)continue;basis.add(X.base.row);basis.add(Y.last.row);const e=m.edges.find(e=>e.view===v),f=m.features.find(f=>f.view===v&&f.ends);if(e||f){const A=e?e.A:f.C,B=e?e.B:f.ends[0],delta=D.sub(B.p,A.p);basis.add(expr([B.x,-delta.y],[B.y,delta.x],[A.x,delta.y],[A.y,-delta.x]));}}
 linkProjection(m,views,basis,options);
 if(views.length>1&&views.some(v=>v.role==='single'))m.issue('部分图形尚未建立投影对应，暂按独立视图计数；可在“视图与对应”中调整',[]);
 const ignored=new Set(options.referenceIds||[]),cycles=[];
 const inside=(d,v)=>[d.p1,d.p2,d.c].filter(Boolean).every(p=>p.x>=v.box.x-TOL&&p.x<=v.box.right+TOL&&p.y>=v.box.y-TOL&&p.y<=v.box.bottom+TOL),skipped=new Set(groups.filter(v=>v.role==='ignore').flatMap(v=>v.objects.map(o=>o.id)));for(const d of objects.filter(o=>o.type==='dim')){const refs=[d.circleId,d.ref1?.id,d.ref2?.id,...D.measurementRefs(d.measurement).map(r=>r.id)].filter(Boolean);if(refs.length&&refs.every(id=>skipped.has(id)))continue;if(options.onlyManual&&(refs.length?refs.every(id=>!m.owners.has(id)):!views.some(v=>inside(d,v))))continue;if(!refs.length&&groups.some(v=>v.role==='ignore'&&inside(d,v))&&!views.some(v=>inside(d,v)))continue;if(ignored.has(d.id)){out.dimensions.push({id:d.id,label:D.dimLabel(d,options.scale||1),reference:true});continue;}if(d.hideText||(d.override&& !/[0-9０-９]/.test(d.override))){out.dimensions.push({id:d.id,label:'隐藏 / 空白数字',inactive:true});continue;}
  if(!Number.isFinite(D.dimValue(d))||D.dimValue(d)<1e-7){m.issue('有零距离或无效几何尺寸，需要人工确认',[d.id]);continue;}if(/^\s*[2-9]\d*\s*[×xX]/.test(d.override||''))m.issue('数量标注涉及多个特征，请人工确认适用对象',[d.id]);const item=dimensionRow(m,d,objects);if(!item){out.dimensions.push({id:d.id,label:D.dimLabel(d,options.scale||1),unresolved:true});m.issue('有尺寸尚未关联到可识别特征，未用于判定多标',[d.id]);continue;}out.dimensions.push({id:d.id,label:D.dimLabel(d,options.scale||1),viewId:item.view.id});const added=basis.add(item.row,d.id);if(!added.added){out.extra++;cycles.push({ids:new Set(added.ids),count:1});}
 }
 for(const cycle of cycles){let found=out.extraItems.find(g=>g.ids.some(id=>cycle.ids.has(id)));if(found){cycle.ids.forEach(id=>{if(!found.ids.includes(id))found.ids.push(id);});found.count++;}else out.extraItems.push({ids:[...cycle.ids],count:1});}
 out.missing=Math.max(0,m.variables.length-basis.rank);
 const candidates=[];for(const f of m.features){candidates.push({row:expr([f.R,1]),label:f.arc?'圆弧半径':'圆孔 / 圆的直径',value:f.arc?f.r:2*f.r,ids:[f.owner],viewId:f.view.id});const X=axisFrame(m,f.view,'x'),Y=axisFrame(m,f.view,'y');if(X)candidates.push({row:combine([expr([f.C.x,1]),1],[X.base.row,-1]),label:'圆心 / 轴线到横向基准',value:f.C.p.x-X.lo,ids:[f.owner],viewId:f.view.id});if(Y)candidates.push({row:combine([Y.last.row,1],[expr([f.C.y,1]),-1]),label:'圆心 / 轴线到底面基准',value:Y.hi-f.C.p.y,ids:[f.owner],viewId:f.view.id});}
 candidates.push(...m.candidates);
 for(const v of views){for(const key of ['x','y']){const frame=axisFrame(m,v,key);if(!frame)continue;candidates.push({row:combine([frame.last.row,1],[frame.base.row,-1]),label:key==='x'?'横向总体尺寸':'竖向总体尺寸',value:frame.span,ids:v.objects.map(o=>o.id),viewId:v.id});for(const P of m.points.filter(p=>p.view===v&&!p.construction))candidates.push({row:combine([expr([P[key],1]),1],[(key==='x'?frame.base:frame.last).row,-1]),label:key==='x'?'特征到横向基准的位置':'特征到底面基准的位置',value:Math.abs(P.p[key]-(key==='x'?frame.lo:frame.hi)),ids:[...P.owners],viewId:v.id});}}
 const suggestionBasis=new Basis(basis);for(const c of candidates)if(out.missingItems.length<out.missing&&suggestionBasis.add(c.row).added)out.missingItems.push({label:c.label,value:c.value,ids:c.ids,viewId:c.viewId});
 if(out.missingItems.length<out.missing)out.missingItems.push({label:'其余形状 / 角度关系仍需尺寸确定',count:out.missing-out.missingItems.length,ids:[]});
 out.pending=m.pending;out.complete=!out.pending.length&&out.missing===0&&out.extra===0;return out;
}
function validateOptions(raw,objects){const ids=new Set(objects.map(o=>o.id)),used=new Set(),out={enabled:!!raw?.enabled,depthConfirmed:!!raw?.depthConfirmed,onlyManual:!!raw?.onlyManual,views:{},groups:[],referenceIds:[]};if(raw?.views&&typeof raw.views==='object')for(const [id,v] of Object.entries(raw.views).slice(0,100)){if(id.length<120&&v&&roles.includes(v.role))out.views[id]={role:v.role,flipX:!!v.flipX,flipY:!!v.flipY};}for(const g of (Array.isArray(raw?.groups)?raw.groups:[]).slice(0,30))if(typeof g.id==='string'&&g.id.length<100&&Array.isArray(g.ids)){const members=g.ids.filter(id=>ids.has(id)&&!used.has(id)).slice(0,450);members.forEach(id=>used.add(id));if(members.length)out.groups.push({id:g.id,ids:members});}if(!out.groups.length)out.onlyManual=false;out.referenceIds=(Array.isArray(raw?.referenceIds)?raw.referenceIds:[]).filter(id=>ids.has(id)).slice(0,1000);return out;}
const api={inspect,viewsFor,validateOptions};root.DimensionInspection=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
