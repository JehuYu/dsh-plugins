/* Explicit dimension tools share their preview and placement geometry. */
(function(root){
'use strict';
const D=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.Draft;
const {pt,add,sub,mul,dist,len,unit}=D;
function pickTarget({line,curve,point,forcePoint=false}){if(forcePoint)return point;if(line&&(!curve||line.distance<=curve.distance))return {...line,entity:true};if(curve)return {...curve,entity:true};return point;}
function distanceStep(mode,targets=[]){
 const count=targets.length;
 if(mode==='line')return count?{pick:'place',message:'② 点击放置单边长度'}:{pick:'line',message:'① 选择一条直边'};
 if(mode==='points')return count>=2?{pick:'place',message:'③ 点击放置两点距离'}:{pick:'point',message:count?'② 选择第二点 / 交点':'① 选择第一点 / 交点'};
 if(mode==='point-line')return count>=2?{pick:'place',message:'③ 点击放置垂直距离'}:{pick:count?'line':'point',message:count?'② 选择目标直线':'① 选择测量点 / 交点'};
 if(mode==='lines')return count>=2?{pick:'place',message:'③ 点击放置平行线间距'}:{pick:'line',message:count?'② 选择另一条平行线':'① 选择第一条直线'};
 return {pick:'auto',message:'自动识别测量对象'};
}
function pickIntersection(p,objects,tolerance=1){
 const nearby=[];for(const owner of objects)for(const part of D.geometryParts(owner))if(part.type==='line'){
  const hit=D.projectToSegment(p,[part.p1,part.p2]);if(hit&&dist(p,hit.p)<=tolerance)nearby.push({owner,part});
 }
 let best=null;for(let i=0;i<nearby.length;i++)for(let j=i+1;j<nearby.length;j++){
  const a=nearby[i],b=nearby[j],q=D.intersect(a.part.p1,a.part.p2,b.part.p1,b.part.p2);if(!q)continue;
  const distance=dist(p,q);if(distance>tolerance||best&&best.distance<=distance)continue;
  const ref=entry=>({id:entry.owner.id,index:entry.part.index,partIndex:entry.part.index});
  best={type:'point',p:q,entity:true,intersection:{line1:ref(a),line2:ref(b)},distance};
 }return best;
}
function linearKind(a,b,p,forced,aligned=false){
 if(['horizontal','vertical','aligned'].includes(forced))return forced;
 if(Math.abs(a.x-b.x)<.01)return 'vertical';if(Math.abs(a.y-b.y)<.01)return 'horizontal';
 const dx=Math.max(Math.min(a.x,b.x)-p.x,p.x-Math.max(a.x,b.x),0),dy=Math.max(Math.min(a.y,b.y)-p.y,p.y-Math.max(a.y,b.y),0);
 if(aligned){const v=unit(sub(b,a)),along=(p.x-a.x)*v.x+(p.y-a.y)*v.y,normal=Math.abs((p.x-a.x)*v.y-(p.y-a.y)*v.x);if(along>0&&along<dist(a,b)&&normal<8)return 'aligned';}
 return dy>=dx?'horizontal':'vertical';
}
function resolveDistance(targets,pos,objects,{direction}={}){
 if(targets.length===1){const a=targets[0];if(a.type!=='line')return null;const measurement={mode:'line-length',line:a.ref},points=D.resolveMeasurement(measurement,objects);if(!points)return null;return {kind:linearKind(points.p1,points.p2,pos,direction,true),...points,pos,measurement};}
 if(targets.length!==2)return null;let [a,b]=targets;
 if(a.type==='point'&&b.type==='point'){
  // 已关联到图形锚点时按锚点精确取值，避免点击误差带进点间距离
  const anchor=ref=>{const source=ref&&objects.find(o=>o.id===ref.id);if(!source)return null;let p=null;if(ref.point&&Number.isInteger(ref.partIndex)){const part=D.geometryPart(source,ref.partIndex);p=part&&(ref.point==='center'?part.c:ref.point==='start'?part.p1:ref.point==='end'?(part.p3||part.p2):null);}else p=D.anchors(source)[ref.index]||null;return p?add(p,ref.offset||pt(0,0)):null;};
  const p1=D.resolveIntersection(a.intersection,objects)||anchor(a.ref)||a.p,p2=D.resolveIntersection(b.intersection,objects)||anchor(b.ref)||b.p,out={kind:linearKind(p1,p2,pos,direction),p1,p2,pos};if(a.intersection)out.intersection1=D.clone(a.intersection);else if(a.ref)out.ref1=a.ref;if(b.intersection)out.intersection2=D.clone(b.intersection);else if(b.ref)out.ref2=b.ref;return out;
 }
 if(a.type==='line'&&b.type==='point')[a,b]=[b,a];
 const measurement=a.type==='point'?{mode:'point-line',point:a.p,pointRef:a.ref,line:b.ref}:{mode:'line-line',line1:a.ref,line2:b.ref,station:a.station};
 if(a.intersection)measurement.pointIntersection=D.clone(a.intersection);
 const geometry=D.resolveMeasurement(measurement,objects);return geometry?{kind:'linear',...geometry,pos,measurement}:null;
}
function lineIntersection(first,second){
 const [a,b]=first,[c,d]=second,u=sub(b,a),v=sub(d,c),den=u.x*v.y-u.y*v.x;
 if(Math.abs(den)<1e-9)return null;
 const t=((c.x-a.x)*v.y-(c.y-a.y)*v.x)/den;return add(a,mul(u,t));
}
function angleSigns(first,second,pick1,pick2){
 const center=lineIntersection(first.segment,second.segment);if(!center)return null;
 const U=unit(sub(first.segment[1],first.segment[0])),V=unit(sub(second.segment[1],second.segment[0]));
 const s1=Math.sign((pick1.x-center.x)*U.x+(pick1.y-center.y)*U.y)||1;
 const s2=Math.sign((pick2.x-center.x)*V.x+(pick2.y-center.y)*V.y)||1;
 return [s1,s2];
}
function resolveAngle(targets,pos,signs){
 if(targets.length!==2||targets.some(t=>t.type!=='line'))return null;
 const [a,b]=targets,angle=D.measureAngleLines(a.segment,b.segment,pos,signs);if(!angle)return null;
 const {rays,...geometry}=angle;return {kind:'angle',...geometry,pos,measurement:{mode:'line-angle',line1:a.ref,line2:b.ref,ray1:rays[0],ray2:rays[1]}};
}
function suggestSpacing(data,pos,objects,tolerance=1.2){
 if(!data||!data.p1||!data.p2||data.kind==='angle')return null;
 const a=data.p1,b=data.p2,u=data.kind==='horizontal'?pt(1,0):data.kind==='vertical'?pt(0,1):unit(sub(b,a)),n=pt(-u.y,u.x),offset=(pos.x-a.x)*n.x+(pos.y-a.y)*n.y,bases=[0];
 for(const o of objects)if(o.type==='dim'&&o.pos&&!['radius','diameter','angle'].includes(o.kind)){const v=o.kind==='horizontal'?pt(1,0):o.kind==='vertical'?pt(0,1):unit(sub(o.p2,o.p1));if(Math.abs(u.x*v.y-u.y*v.x)<1e-5&&Math.abs((o.p1.x-a.x)*n.x+(o.p1.y-a.y)*n.y)<.05)bases.push((o.pos.x-a.x)*n.x+(o.pos.y-a.y)*n.y);}
 let nearest=null;for(const base of bases)for(const sign of [-1,1]){const target=base+6*sign,error=Math.abs(offset-target);if(error<=tolerance&&(!nearest||error<nearest.error))nearest={p:add(pos,mul(n,target-offset)),error,label:'间距 6 mm'};}return nearest;
}
root.DimensionTool={pickTarget,distanceStep,pickIntersection,resolveDistance,resolveAngle,angleSigns,linearKind,suggestSpacing};if(typeof module!=='undefined'&&module.exports)module.exports=root.DimensionTool;
})(typeof window!=='undefined'?window:globalThis);
