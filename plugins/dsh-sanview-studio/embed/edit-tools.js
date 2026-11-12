/* Pure editing operations. UI code owns history and applies each result atomically. */
(function(root){
'use strict';
const D=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.Draft;
const {pt,add,sub,mul,dist,clone,transform,inverse}=D;
const near=(a,b)=>dist(a,b)<1e-7;
function pathEntries(source){
 if(source.type!=='path')return D.geometryParts(source).map(part=>{
  if(part.type==='line')return {start:part.p1,segment:{cmd:'L',v:[part.p2.x,part.p2.y]}};
  if(part.type==='arc'){const s=D.parsePath(D.arcGeometry(part).d);return {start:pt(...s[0].v),segment:s[1]};}
  throw Error('该形体暂不能裁边');
 });
 const out=[];let p=pt(0,0),start=p,previous='',control=null;
 for(const s of source.segments){
  const v=s.v;let segment=clone(s),next=v.length?pt(v.at(-2),v.at(-1)):start,nextControl=null;
  if(s.cmd==='M'){p=pt(...v);start=p;previous='M';control=null;continue;}
  if(s.cmd==='Z')segment={cmd:'L',v:[start.x,start.y]};
  if(s.cmd==='S'){const a=['C','S'].includes(previous)&&control?sub(mul(p,2),control):p;segment={cmd:'C',v:[a.x,a.y,...v]};nextControl=pt(v[0],v[1]);}
  else if(s.cmd==='T'){const a=['Q','T'].includes(previous)&&control?sub(mul(p,2),control):p;segment={cmd:'Q',v:[a.x,a.y,...v]};nextControl=a;}
  else if(s.cmd==='C')nextControl=pt(v[2],v[3]);
  else if(s.cmd==='Q')nextControl=pt(v[0],v[1]);
  out.push({start:{...p},segment});p=next;previous=s.cmd;control=nextControl;
 }
 return out;
}
function replaceEdges(source,replacements){
 if(source.type==='line'){const edge=replacements.get(0);return edge?{...clone(source),p1:{...edge[0]},p2:{...edge[1]}}:clone(source);}
 if(!['rect','poly','profile','path'].includes(source.type))throw Error('请选择可编辑的直边');
 const matrix=source.type==='path'?(source.matrix||[1,0,0,1,0,0]):[1,0,0,1,0,0];
 if(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12)throw Error('图形变换无效，无法裁边');
 const entries=pathEntries(source),segments=[];
 for(const [index,entry] of entries.entries()){
  const edge=replacements.get(index),a=edge?inverse(edge[0],matrix):entry.start;
  segments.push({cmd:'M',v:[a.x,a.y]});
  if(edge){const b=inverse(edge[1],matrix);segments.push({cmd:'L',v:[b.x,b.y]});}
  else segments.push(clone(entry.segment));
 }
 const out={...clone(source),type:'path',segments,matrix:[...matrix]};
 for(const key of ['p1','p2','p3','c','r','points','closed','profile','radius','startAngle','sweepAngle'])delete out[key];
 return out;
}
function edgeAt(objects,ref){
 const owner=objects.find(o=>o.id===ref.id),part=owner&&D.geometryPart(owner,ref.partIndex??ref.index);
 if(!owner||part?.type!=='line')throw Error('所选边已改变，请重新选择');
 return {owner,part,edge:[part.p1,part.p2]};
}
function repairAnchorReferences(objects,before,after){
 const anchors=D.anchors(after);
 const remap=ref=>{
  const old=D.referencePoint(before,ref);if(!old||!anchors.length)return;
  let index=anchors.findIndex(a=>near(a,old));
  // A removed corner is still a useful virtual measurement point. Keep it
  // relative to the same owner so moving the outline also moves its dimensions.
  if(index<0){index=anchors.reduce((best,a,i)=>dist(a,old)<dist(anchors[best],old)?i:best,0);ref.offset=add(ref.offset||pt(0,0),sub(old,anchors[index]));}
  ref.index=index;
 };
 for(const o of objects.filter(o=>o.type==='dim')){
  for(const key of ['ref1','ref2']){
   const ref=o[key];if(ref?.id!==before.id||Number.isInteger(ref.partIndex))continue;
   remap(ref);
  }
  const m=o.measurement,ref=m?.pointRef;
  if(ref?.id===before.id&&!Number.isInteger(ref.partIndex)){
   remap(ref);
  }
 }
}
function applyReplacements(objects,changes){
 const out=clone(objects);
 for(const [id,replacements] of changes){
  const index=out.findIndex(o=>o.id===id),before=out[index],after=replaceEdges(before,replacements);
  repairAnchorReferences(out,before,after);out[index]=after;
 }
 return out;
}
function replacePartObjects(objects,ref,pieces=[]){
 const before=objects.find(o=>o.id===ref.id);if(!before)throw Error('所选对象已不存在');
 const index=ref.partIndex??ref.index??0,compound=['rect','poly','profile','path'].includes(before.type),parts=D.geometryParts(before);
 if(!parts[index]&&!['text','dim'].includes(before.type))throw Error('所选边已改变，请重新选择');
 let remaining=null;
 if(compound){
  const entries=pathEntries(before).filter((_,i)=>i!==index);
  if(entries.length){
   remaining={...replaceEdges(before,new Map()),segments:entries.flatMap(entry=>[{cmd:'M',v:[entry.start.x,entry.start.y]},clone(entry.segment)])};
  }
 }else if(pieces.length)pieces[0].id=before.id;
 const replacements=[remaining,...pieces].filter(Boolean),out=clone(objects).flatMap(o=>o.id===before.id?clone(replacements):[o]);
 const edgeRef=old=>{
  if(old.id!==before.id)return clone(old);
  const partIndex=old.partIndex??old.index;
  if(partIndex===index){if(!pieces.length)return null;return {...clone(old),id:pieces[0].id,index:0,partIndex:0};}
  if(!remaining)return null;
  const next=partIndex>index?partIndex-1:partIndex;return {...clone(old),index:next,partIndex:next};
 };
 const anchorRef=old=>{
  if(old.id!==before.id)return clone(old);
  const anchor=D.referencePoint(before,old);if(!anchor)return null;const wanted=add(anchor,old.offset||pt(0,0));
  let best=null;
  for(const source of replacements)for(const [i,p] of D.anchors(source).entries()){
   const distance=dist(p,wanted);if(!best||distance<best.distance)best={id:source.id,index:i,p,distance};
  }
  if(!best)return null;return {id:best.id,index:best.index,...(best.distance>1e-8?{offset:sub(wanted,best.p)}:{})};
 };
 for(const o of out)if(o.corner){let valid=true;for(const ref of [o.corner.first,o.corner.second])if(ref.id===before.id){if((ref.partIndex??ref.index)===index){valid=false;break;}const next=edgeRef(ref);if(next)Object.assign(ref,next);else valid=false;}if(!valid)delete o.corner;}
 for(const d of out.filter(o=>o.type==='dim')){
  for(const holder of [d,d.measurement].filter(Boolean))for(const key of ['intersection1','intersection2','pointIntersection'])if(holder[key]){
   const spec=holder[key],point=key==='intersection2'?d.p2:key==='pointIntersection'?d.measurement.point:d.p1;let valid=true;
   for(const name of ['line1','line2']){
    const old=spec[name];if(old.id!==before.id)continue;let next=edgeRef(old);
    if((old.partIndex??old.index)===index&&pieces.length){const piece=pieces.find(o=>{const hit=D.projectToSegment(point,[o.p1,o.p2]);return hit&&dist(hit.p,point)<1e-6;});next=piece?{id:piece.id,index:0,partIndex:0}:null;}
    if(next)spec[name]=next;else valid=false;
   }if(!valid)delete holder[key];
  }
  for(const key of ['ref1','ref2'])if(d[key]){const ref=anchorRef(d[key]);if(ref)d[key]=ref;else delete d[key];}
  if(d.circleId===before.id){
   const partIndex=d.circlePart??0;
   if(partIndex===index||!remaining){delete d.circleId;delete d.circlePart;delete d.circleOffset;}
   else if(partIndex>index)d.circlePart=partIndex-1;
  }
  const m=d.measurement;if(!m)continue;
  const removed=m.mode==='line-length'&&m.line.id===before.id&&(m.line.partIndex??m.line.index)===index;
  if(removed&&pieces.length===2){
   d.ref1={id:pieces[0].id,index:0,...(m.line.offset?{offset:clone(m.line.offset)}:{})};d.ref2={id:pieces[1].id,index:1,...(m.line.offset?{offset:clone(m.line.offset)}:{})};delete d.measurement;continue;
  }
  let valid=true;
  for(const key of ['pointRef','line','line1','line2'])if(m[key]){const ref=key==='pointRef'?anchorRef(m[key]):edgeRef(m[key]);if(ref)m[key]=ref;else valid=false;}
  if(!valid)delete d.measurement;
 }
 D.updateLinked(out);return {objects:out,pieces:pieces.map(p=>p.id)};
}
function splitLine(objects,ref,point){
 const {owner,edge}=edgeAt(objects,ref),hit=D.projectToSegment(point,edge);
 if(!hit||dist(hit.p,edge[0])<.05||dist(hit.p,edge[1])<.05)throw Error('请在线段内部选分割点，不能点在端点上');
 const make=(a,b)=>{const o=D.shape('line',{p1:{...a},p2:{...b}},owner.layer,owner.style);for(const key of ['width','viewGroup','projectionRole'])if(owner[key]!=null)o[key]=clone(owner[key]);return o;};
 return {...replacePartObjects(objects,ref,[make(edge[0],hit.p),make(hit.p,edge[1])]),point:hit.p};
}
function erasePart(objects,ref){return replacePartObjects(objects,ref);}
function fillet(objects,first,second,radius){
 if(first.id===second.id&&(first.partIndex??first.index)===(second.partIndex??second.index))throw Error('请选择另一条边');
 const a=edgeAt(objects,first),b=edgeAt(objects,second),r=D.filletBetween(a.edge,b.edge,radius);
 if(!r)throw Error('这两条边无法生成圆角：需相交且夹角合适');
 // The available ray length can be shorter than the whole segment at a T crossing.
 const remaining=(edge,tangent)=>{const index=dist(edge[0],r.vertex)<=dist(edge[1],r.vertex)?0:1;return {edge:edge.map((p,i)=>i===index?{...tangent}:{...p}),available:Math.max(dist(edge[0],r.vertex),dist(edge[1],r.vertex))};};
 const one=remaining(a.edge,r.t1),two=remaining(b.edge,r.t2);
 if(r.reach>=one.available-1e-7||r.reach>=two.available-1e-7)throw Error('圆角太大，请减小半径');
 const changes=new Map();
 for(const [target,edge] of [[a,one.edge],[b,two.edge]]){if(!changes.has(target.owner.id))changes.set(target.owner.id,new Map());changes.get(target.owner.id).set(target.part.index,edge);}
 const out=applyReplacements(objects,changes),arc=D.shape('arc',{c:r.center,r:r.r,startAngle:r.startAngle,sweepAngle:r.sweep},a.owner.layer,a.owner.style);
 if(a.owner.width)arc.width=a.owner.width;
 arc.corner={kind:'fillet',first:{id:first.id,partIndex:a.part.index,end:dist(a.edge[0],r.vertex)<=dist(a.edge[1],r.vertex)?0:1},second:{id:second.id,partIndex:b.part.index,end:dist(b.edge[0],r.vertex)<=dist(b.edge[1],r.vertex)?0:1},radius};
 for(const key of ['viewGroup','projectionRole'])if(a.owner[key]&&a.owner[key]===b.owner[key])arc[key]=a.owner[key];
 out.push(arc);D.updateLinked(out);return {objects:out,arc,result:r};
}
function chamferGeometry(first,second,distance1,distance2=distance1){
 if(![distance1,distance2].every(n=>Number.isFinite(n)&&n>=.05&&n<=10000))throw Error('倒角距离请设为 0.05–10000 mm');
 const hit=lineIntersection(first,second);if(!hit||hit.t< -1e-7||hit.t>1+1e-7||hit.s< -1e-7||hit.s>1+1e-7)throw Error('请选择两条实际相交且不平行的直边');
 const vertex=hit.point;
 const cut=(edge,distance)=>{const index=dist(edge[0],vertex)<=dist(edge[1],vertex)?0:1,far=edge[1-index],available=dist(far,vertex);if(distance>=available-1e-7)throw Error('倒角距离太大，请减小距离');const point=add(vertex,mul(D.unit(sub(far,vertex)),distance));return {point,edge:edge.map((p,i)=>i===index?point:{...p})};};
 const a=cut(first,distance1),b=cut(second,distance2);return {vertex,p1:a.point,p2:b.point,edges:[a.edge,b.edge]};
}
function chamfer(objects,first,second,distance1,distance2=distance1){
 if(first.id===second.id&&(first.partIndex??first.index)===(second.partIndex??second.index))throw Error('请选择另一条边');
 const a=edgeAt(objects,first),b=edgeAt(objects,second),result=chamferGeometry(a.edge,b.edge,distance1,distance2),changes=new Map();
 for(const [target,edge] of [[a,result.edges[0]],[b,result.edges[1]]]){if(!changes.has(target.owner.id))changes.set(target.owner.id,new Map());changes.get(target.owner.id).set(target.part.index,edge);}
 const out=applyReplacements(objects,changes),line=D.shape('line',{p1:result.p1,p2:result.p2},a.owner.layer,a.owner.style);
 if(a.owner.width)line.width=a.owner.width;for(const key of ['viewGroup','projectionRole'])if(a.owner[key]&&a.owner[key]===b.owner[key])line[key]=a.owner[key];
 line.corner={kind:'chamfer',first:{id:first.id,partIndex:a.part.index,end:dist(a.edge[0],result.vertex)<=dist(a.edge[1],result.vertex)?0:1},second:{id:second.id,partIndex:b.part.index,end:dist(b.edge[0],result.vertex)<=dist(b.edge[1],result.vertex)?0:1},distance1,distance2};
 out.push(line);D.updateLinked(out);return {objects:out,line,result};
}
function resizeCorner(objects,id,values){
 const current=objects.find(o=>o.id===id),spec=current?.corner;if(!spec)throw Error('该对象没有可编辑的圆角或倒角关联');
 const a=edgeAt(objects,spec.first),b=edgeAt(objects,spec.second),hit=lineIntersection(a.edge,b.edge);if(!hit)throw Error('关联边已平行，无法重新生成');
 const changes=new Map();for(const [ref,source] of [[spec.first,a],[spec.second,b]]){const edge=source.edge.map((p,i)=>i===ref.end?hit.point:p);if(!changes.has(ref.id))changes.set(ref.id,new Map());changes.get(ref.id).set(ref.partIndex,edge);}
 const restored=applyReplacements(objects,changes),settings={...spec,...values},result=spec.kind==='fillet'?fillet(restored,spec.first,spec.second,settings.radius):chamfer(restored,spec.first,spec.second,settings.distance1,settings.distance2),generated=result.arc||result.line;
 const replacement={...clone(current),...generated,id,style:current.style,layer:current.layer};if(Number.isFinite(current.width))replacement.width=current.width;else delete replacement.width;
 const out=result.objects.filter(o=>o.id!==generated.id).map(o=>o.id===id?replacement:o);D.updateLinked(out);return out;
}
function syncCorners(objects,previous){
 let out=objects;const oldById=new Map(previous.map(o=>[o.id,o])),geometry=o=>o&&JSON.stringify(D.geometryParts(o));
 for(const original of objects.filter(o=>o.corner)){
  const current=out.find(o=>o.id===original.id),old=oldById.get(current.id),refs=[current.corner.first,current.corner.second];
  if(refs.some(ref=>!out.some(o=>o.id===ref.id))){if(out===objects)out=clone(objects);delete out.find(o=>o.id===current.id).corner;continue;}
  if(!old||geometry(current)!==geometry(old))continue;
  if(refs.some(ref=>geometry(out.find(o=>o.id===ref.id))!==geometry(oldById.get(ref.id))))out=resizeCorner(out,current.id,{});
 }return out;
}
function batchProperties(objects,ids,key,value){
 const names=typeof module!=='undefined'&&module.exports?require('./app-names.js'):root.AppNames,selected=new Set(ids),out=clone(objects),valid={style:['solid','thin','hidden','center'],distanceStyle:Object.keys(names.distanceStyles),radiusStyle:Object.keys(names.radiusStyles),diameterStyle:Object.keys(names.diameterStyles)};
 if(key==='textSize'){if(!Number.isFinite(value)||value<.5||value>20)throw Error('字高请设为 0.5–20 mm');}else if(!valid[key]?.includes(value))throw Error('批量设置无效');
 for(const o of out)if(selected.has(o.id)){if(key==='style'&&!['dim','text'].includes(o.type)){o.style=value;delete o.width;}if(key==='textSize'&&o.type==='dim')o.textSize=value;if(key==='textSize'&&o.type==='text'){o.size=value;delete o.textSize;}if(o.type==='dim'&&(key==='distanceStyle'&&!['radius','diameter','angle'].includes(o.kind)||key==='radiusStyle'&&o.kind==='radius'||key==='diameterStyle'&&o.kind==='diameter')){o[key]=value;if(key==='distanceStyle')delete o.miter;}}
 return out;
}
function lineIntersection(a,b){
 const u=sub(a[1],a[0]),v=sub(b[1],b[0]),den=u.x*v.y-u.y*v.x;
 if(Math.abs(den)<1e-9)return null;const w=sub(b[0],a[0]);
 const t=(w.x*v.y-w.y*v.x)/den,s=(w.x*u.y-w.y*u.x)/den;
 return {point:add(a[0],mul(u,t)),t,s};
}
function trimEdge(boundary,target,click,extend=false){
 const hit=lineIntersection(target,boundary);
 if(!hit)throw Error('两条边平行或长度为零，无法相交');
 if(hit.s< -1e-7||hit.s>1+1e-7)throw Error('交点不在边界线段上，请选择另一条边界');
 // Trim the side of the intersection that was clicked, even when the cut
 // is very close to an endpoint. Endpoint distance gives the wrong side here.
 const v=sub(target[1],target[0]),w=sub(click,target[0]),station=(w.x*v.x+w.y*v.y)/(v.x*v.x+v.y*v.y);
 const index=extend?(dist(click,target[0])<=dist(click,target[1])?0:1):(station<hit.t?0:1);
 if(extend?(index===0?hit.t>=-1e-7:hit.t<=1+1e-7):(hit.t<=1e-7||hit.t>=1-1e-7))throw Error(extend?'请点击需要延伸的端点一侧':'交点需落在待修剪的边内');
 return {edge:target.map((p,i)=>i===index?hit.point:p),changed:[target[index],hit.point],intersection:hit.point};
}
function trimExtend(objects,boundary,target,click,extend=false){
 const a=edgeAt(objects,boundary),b=edgeAt(objects,target);
 if(a.owner.id===b.owner.id&&a.part.index===b.part.index)throw Error('请点选另一条边');
 const {edge}=trimEdge(a.edge,b.edge,click,extend),out=applyReplacements(objects,new Map([[b.owner.id,new Map([[b.part.index,edge]])]]));
 D.updateLinked(out);return out;
}
function pickEditablePart(objects,point,types,tolerance,hitId,exactParts=false){
 const nearest=owners=>{
  let best=null;
  for(const owner of owners){
   const parts=exactParts?D.geometryParts(owner):[...D.geometryParts(owner).filter(p=>p.type==='line'),...D.circularParts(owner)];
   for(const part of parts){
    if(!types.includes(part.type))continue;
    const p=part.type==='line'?D.projectToSegment(point,[part.p1,part.p2])?.p:D.closestCurvePoint(point,part);
    if(!p)continue;const distance=dist(point,p);
    if(!best||distance<best.distance)best={owner,part,p,distance};
   }
  }
  return best;
 };
 // The SVG hit stroke is wider than the visual stroke, especially at high
 // zoom. Honor that actual hit before doing a nearest-edge fallback.
 const direct=hitId&&nearest(objects.filter(o=>o.id===hitId));
 if(direct&&direct.distance<=Math.max(tolerance,1.75))return direct;
 const best=nearest(objects);return best&&best.distance<=tolerance?best:null;
}
function offsetPart(part,distance,click,source){
 if(!(distance>0&&Number.isFinite(distance)))throw Error('偏移距离必须大于 0');
 let data,type=part.type;
 if(type==='line'){
  const v=sub(part.p2,part.p1),length=dist(part.p1,part.p2);if(length<1e-8)throw Error('无法偏移零长度线段');
  const n=pt(-v.y/length,v.x/length),side=(click.x-part.p1.x)*n.x+(click.y-part.p1.y)*n.y>=0?1:-1,delta=mul(n,distance*side);
  data={p1:add(part.p1,delta),p2:add(part.p2,delta)};
 }else if(['circle','arc'].includes(type)){
  const r=part.r+(dist(click,part.c)>=part.r?distance:-distance);if(r<=.05)throw Error('偏移距离超过圆或圆弧的半径');
  data={c:{...part.c},r,...(type==='arc'?{startAngle:part.startAngle,sweepAngle:part.sweepAngle}:{})};
 }else throw Error('请选择直线、圆或圆弧');
 const out=D.shape(type,data,source.layer,source.style);if(source.width)out.width=source.width;return out;
}
function rotationStep(gesture,point,snap=false){
 if(dist(point,gesture.pivot)<1e-8)return {...gesture};
 const lastAngle=Math.atan2(point.y-gesture.pivot.y,point.x-gesture.pivot.x)*180/Math.PI;
 const delta=((gesture.lastAngle-lastAngle+540)%360+360)%360-180,total=gesture.total+delta;
 return {...gesture,lastAngle,total,angle:snap?Math.round(total/15)*15:total};
}
function rotationIds(objects,ids){
 const moving=D.withCornerMembers(objects,ids);
 for(const o of objects.filter(o=>o.type==='dim')){
  const refs=[o.ref1,o.ref2,...D.measurementRefs(o.measurement),...D.intersectionRefs(o)].filter(Boolean).map(r=>r.id);
  if(o.circleId)refs.push(o.circleId);
  if(refs.length&&refs.every(id=>moving.has(id)))moving.add(o.id);
 }
 return moving;
}
// Positive angles turn counterclockwise in drawing coordinates (SVG Y points down).
function rotateSelection(objects,ids,degrees,pivot){
 if(!Number.isFinite(degrees)||Math.abs(degrees)>360000||![pivot?.x,pivot?.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7))throw Error('请输入有效的旋转角度与中心坐标');
 const moving=rotationIds(objects,ids),angle=-(degrees%360),r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r),matrix=[c,s,-s,c,pivot.x*(1-c)+pivot.y*s,pivot.y*(1-c)-pivot.x*s],vector=p=>pt(c*p.x-s*p.y,s*p.x+c*p.y),point=p=>transform(p,matrix);
 if(Math.abs(angle)<1e-10)return clone(objects);
 const oldById=new Map(objects.map(o=>[o.id,o])),converted=new Set(),out=clone(objects);
 for(let i=0;i<out.length;i++){
  let o=out[i];if(!moving.has(o.id))continue;
  if(['rect','profile'].includes(o.type)){o=out[i]=replaceEdges(o,new Map());converted.add(o.id);}
  if(o.type==='path')o.matrix=D.matrixMultiply(matrix,o.matrix||[1,0,0,1,0,0]);
  else{
   for(const key of ['p1','p2','p3','c','p','pos'])if(o[key])o[key]=point(o[key]);
   if(o.points)o.points=o.points.map(point);
   if(o.type==='arc'&&o.c)o.startAngle+=angle;
  }
  if(o.type==='text')o.textAngle=(o.textAngle||0)+angle;
  if(o.type==='dim'){
   if(['horizontal','vertical'].includes(o.kind)||o.kind==='diameter'&&['horizontal','vertical'].includes(o.diameterStyle))o.axisAngle=(o.axisAngle||0)+angle;
   if(Number.isFinite(o.textAngle))o.textAngle+=angle;
   if(o.textOffset)o.textOffset=vector(o.textOffset);
   if(o.curvePoints)o.curvePoints=o.curvePoints.map(point);
   if(Number.isFinite(o.arcStart))o.arcStart+=angle;
   if(o.measurement?.point)o.measurement.point=point(o.measurement.point);
   for(const spec of D.intersectionSpecs(o))if(spec.offset)spec.offset=vector(spec.offset);
   if(o.extensionSources)o.extensionSources=o.extensionSources.map(edge=>edge?.map(point)||null);
   for(const edit of Object.values(o.partEdits||{}))for(const key of ['offset','start','end'])if(edit[key])edit[key]=vector(edit[key]);
  }
 }
 const byId=new Map(out.map(o=>[o.id,o]));
 for(const d of out.filter(o=>o.type==='dim')){
  const old=oldById.get(d.id),own=moving.has(d.id);
  for(const [ref,previous] of [[d.ref1,old.ref1],[d.ref2,old.ref2],...D.measurementRefs(d.measurement).map((ref,i)=>[ref,D.measurementRefs(old.measurement)[i]])]){
   if(!ref||!previous)continue;
   const source=byId.get(ref.id),before=oldById.get(ref.id),anchor=before&&D.referencePoint(before,previous);if(!source||!anchor)continue;
   const follows=own||moving.has(ref.id),wanted=follows?point(add(anchor,previous.offset||pt(0,0))):add(anchor,previous.offset||pt(0,0));
   if(converted.has(ref.id)&&!Number.isInteger(ref.partIndex)){
    const anchors=D.anchors(source),desired=point(anchor);
    ref.index=anchors.reduce((best,p,i)=>dist(p,desired)<dist(anchors[best],desired)?i:best,0);
   }
   if(follows){const actual=D.referencePoint(source,ref);if(actual)ref.offset=sub(wanted,actual);}
  }
  if(d.circleId&&(own||moving.has(d.circleId))){
   const source=byId.get(d.circleId),part=source&&D.circlePart(source,d.circlePart);
   if(part)d.circleOffset=sub(point(old.c),part.c);
  }
  // Line measurement offsets are vectors, rather than anchor references.
  for(const ref of D.measurementRefs(d.measurement))if(!ref.point&&ref!==d.measurement?.pointRef&&(own||moving.has(ref.id))){
   const previous=D.measurementRefs(old.measurement).find(p=>p.id===ref.id&&p.index===ref.index&&p.partIndex===ref.partIndex);
   if(previous?.offset)ref.offset=vector(previous.offset);else delete ref.offset;
  }
 }
 D.updateLinked(out);return out;
}
function mirrorShape(source,axis,origin){
 if(!['x','y'].includes(axis))throw Error('镜像轴无效');
 if(source.type==='dim'||source.type==='text')return null;
 const matrix=axis==='x'?[-1,0,0,1,2*origin,0]:[1,0,0,-1,0,2*origin];
 const out=clone(source);out.id=D.id();delete out.viewGroup;delete out.projectionRole;
 if(source.type==='path')out.matrix=D.matrixMultiply(matrix,out.matrix||[1,0,0,1,0,0]);
 else if(source.type==='arc'){
  const a=D.geometryParts(source)[0];out.c=transform(a.c,matrix);out.r=a.r;
  out.startAngle=D.arcAngle(out.c,transform(a.p1,matrix));out.sweepAngle=-a.sweepAngle;
  delete out.p1;delete out.p2;delete out.p3;
 }else if(source.type==='profile'){
  const path=replaceEdges(source,new Map());return {...path,id:out.id,matrix,viewGroup:undefined,projectionRole:undefined};
 }else{for(const key of ['p1','p2','p3','c'])if(out[key])out[key]=transform(out[key],matrix);if(out.points)out.points=out.points.map(p=>transform(p,matrix));}
 return out;
}
// Escape removes one unfinished step and never writes an object to the document.
function backStep(state){
 const out=clone(state);out.distanceDirection=null;
 if(out.filletEdges.length)out.filletEdges.pop();
 else if(out.measureTargets.length){out.measureTargets.pop();out.draft=out.measureTargets.map(t=>t.p);}
 else if(out.draft.length){out.draft.pop();if(out.draftRefs.length>out.draft.length)out.draftRefs.length=out.draft.length;if(out.angleEdges.length>Math.max(0,out.draft.length-1))out.angleEdges.length=Math.max(0,out.draft.length-1);}
 return out;
}
function constrainDrawingPoint(tool,start,point){
 const out={...point},dx=point.x-start.x,dy=point.y-start.y;
 if(tool==='rect'){const size=Math.max(Math.abs(dx),Math.abs(dy));out.x=start.x+(dx<0?-size:size);out.y=start.y+(dy<0?-size:size);}
 else if(Math.abs(dx)>Math.abs(dy))out.y=start.y;else out.x=start.x;
 return out;
}
function precisionPoint(tool,points,one,two,arcMode='center'){
 if(!Number.isFinite(one)||!Number.isFinite(two))throw Error('请输入有效数值');
 const checked=p=>{if(![p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7))throw Error('坐标超出可编辑范围');return p;};
 if(!points.length||tool==='arc'&&['three','endpoints'].includes(arcMode))return checked(pt(one,two));
 const base=tool==='poly'?points.at(-1):points[0];
 if(tool==='rect'){if(Math.abs(one)<.05||Math.abs(two)<.05)throw Error('宽和高不能为 0');return checked(add(base,pt(one,two)));}
 if(one<.05)throw Error(tool==='circle'||tool==='arc'?'半径需大于 0':'长度需大于 0');
 const angle=two*Math.PI/180;return checked(add(base,pt(Math.cos(angle)*one,-Math.sin(angle)*one)));
}
const api={pathEntries,replaceEdges,repairAnchorReferences,replacePartObjects,splitLine,erasePart,resizeCorner,syncCorners,batchProperties,fillet,chamferGeometry,chamfer,lineIntersection,trimEdge,trimExtend,pickEditablePart,offsetPart,rotationStep,rotationIds,rotateSelection,mirrorShape,backStep,constrainDrawingPoint,precisionPoint};
root.EditingTools=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
