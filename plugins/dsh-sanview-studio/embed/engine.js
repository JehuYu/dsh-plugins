(function(root){
'use strict';
const NS='http://www.w3.org/2000/svg';
const clone=o=>JSON.parse(JSON.stringify(o));
const pt=(x,y)=>({x,y});
const add=(a,b)=>pt(a.x+b.x,a.y+b.y), sub=(a,b)=>pt(a.x-b.x,a.y-b.y), mul=(a,k)=>pt(a.x*k,a.y*k);
const len=a=>Math.hypot(a.x,a.y), dist=(a,b)=>len(sub(a,b));
const unit=a=>mul(a,1/(len(a)||1));
const round=(n,d=2)=>Number(n.toFixed(d));
const fmt=n=>String(round(n,2));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
let serial=0;const id=()=>`e${Date.now().toString(36)}${(serial++).toString(36)}`;
function shape(type,data,layer='front',style='solid'){return {id:id(),type,layer,style,...(type==='dim'?{extension:2}:{}),...data};}
function anchors(o){
 if(o.type==='profile')return profileGeometry(o).anchors;
 if(o.type==='arc'){const arc=arcGeometry(o);return arc?[arc.p1,arc.p2,arc.p3,arc.c]:[];}
 if(o.type==='line')return [o.p1,o.p2,mul(add(o.p1,o.p2),.5)];
 if(o.type==='rect'){const {p1:a,p2:b}=o;return [a,pt(b.x,a.y),b,pt(a.x,b.y),pt((a.x+b.x)/2,a.y),pt(b.x,(a.y+b.y)/2),pt((a.x+b.x)/2,b.y),pt(a.x,(a.y+b.y)/2)];}
 if(o.type==='circle')return [o.c,pt(o.c.x+o.r,o.c.y),pt(o.c.x,o.c.y+o.r),pt(o.c.x-o.r,o.c.y),pt(o.c.x,o.c.y-o.r)];
 if(o.type==='poly')return o.points;
 if(o.type==='path')return pathAnchors(o);
 if(o.type==='text')return [o.p];
 return [];
}
function transform(p,m=[1,0,0,1,0,0]){return pt(m[0]*p.x+m[2]*p.y+m[4],m[1]*p.x+m[3]*p.y+m[5]);}
function inverse(p,m=[1,0,0,1,0,0]){const det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-12)return p;return pt((m[3]*(p.x-m[4])-m[2]*(p.y-m[5]))/det,(-m[1]*(p.x-m[4])+m[0]*(p.y-m[5]))/det);}
// Expand relative SVG commands to absolute segments, preserving Bézier curves and elliptical arcs.
function parsePath(d){
 const t=(d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[]), counts={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
 let i=0,cmd='',p=pt(0,0),start=p,out=[];
 while(i<t.length){
  if(/^[a-z]$/i.test(t[i]))cmd=t[i++];
  const c=cmd.toUpperCase(),n=counts[c],rel=cmd!==c;
  if(n===undefined)throw Error('SVG 路径含不支持的指令');
  if(c==='Z'){out.push({cmd:'Z',v:[]});p={...start};cmd='';continue;}
  if(!cmd||i+n>t.length||t.slice(i,i+n).some(v=>/^[a-z]$/i.test(v)))throw Error('SVG 路径不完整');
  let v=t.slice(i,i+n).map(Number);i+=n;
  if(!v.every(Number.isFinite))throw Error('SVG 路径坐标无效');
  let actual=c;
  if(c==='H'){v=[v[0]+(rel?p.x:0),p.y];actual='L';}
  else if(c==='V'){v=[p.x,v[0]+(rel?p.y:0)];actual='L';}
  else if(c==='A'){if(rel){v[5]+=p.x;v[6]+=p.y;}if(v[0]<0||v[1]<0||![0,1].includes(v[3])||![0,1].includes(v[4]))throw Error('SVG 圆弧参数无效');}
  else if(rel)for(let j=0;j<v.length;j+=2){v[j]+=p.x;v[j+1]+=p.y;}
  p=pt(v[v.length-2],v[v.length-1]);if(c==='M'){start={...p};cmd=rel?'l':'L';}
  out.push({cmd:actual,v});
 }
 return out;
}
function pathD(o){return o.segments.map(s=>s.cmd+' '+s.v.map(n=>round(n,5)).join(' ')).join(' ');}
function pathAnchors(o){return o.segments.filter(s=>s.v.length).map(s=>transform(pt(s.v.at(-2),s.v.at(-1)),o.matrix));}
function move(o,delta){
 if(o.type==='path'){o.matrix=o.matrix||[1,0,0,1,0,0];o.matrix[4]+=delta.x;o.matrix[5]+=delta.y;}
 else if(o.type==='dim'){for(const k of ['p1','p2','pos','c'])if(o[k])o[k]=add(o[k],delta);if(o.curvePoints)o.curvePoints=o.curvePoints.map(p=>add(p,delta));if(o.extensionSources)o.extensionSources=o.extensionSources.map(s=>s?.map(p=>add(p,delta))||null);if(o.measurement?.point)o.measurement.point=add(o.measurement.point,delta);}
 else {for(const k of ['p1','p2','p3','c','p'])if(o[k])o[k]=add(o[k],delta);if(o.points)o.points=o.points.map(p=>add(p,delta));}
 return o;
}
function matrixMultiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function scaleObject(o,k){
 if(o.type==='path')o.matrix=matrixMultiply([k,0,0,k,0,0],o.matrix||[1,0,0,1,0,0]);
 else{for(const key of ['p1','p2','p3','c','p','pos'])if(o[key])o[key]=mul(o[key],k);if(o.points)o.points=o.points.map(p=>mul(p,k));if(o.r)o.r*=k;if(o.radius)o.radius*=k;if(o.size)o.size*=k;}
 if(o.curvePoints)o.curvePoints=o.curvePoints.map(p=>mul(p,k));
 if(o.width)o.width*=k;
 if(o.textOffset)o.textOffset=mul(o.textOffset,k);
 if(o.circleOffset)o.circleOffset=mul(o.circleOffset,k);
 if(o.corner)for(const key of ['radius','distance1','distance2'])if(o.corner[key]!=null)o.corner[key]*=k;
 for(const key of ['ref1','ref2'])if(o[key]?.offset)o[key].offset=mul(o[key].offset,k);
 for(const spec of intersectionSpecs(o))if(spec.offset)spec.offset=mul(spec.offset,k);
 if(o.measurement){if(o.measurement.point)o.measurement.point=mul(o.measurement.point,k);for(const ref of measurementRefs(o.measurement))if(ref.offset)ref.offset=mul(ref.offset,k);}
 for(const edit of Object.values(o.partEdits||{}))for(const key of ['offset','start','end'])if(edit[key])edit[key]=mul(edit[key],k);
 return o;
}
function updateLinked(objects){const byId=new Map(objects.map(o=>[o.id,o]));for(const d of objects.filter(o=>o.type==='dim')){
 if(d.circleId){const source=byId.get(d.circleId),c=circlePart(source,d.circlePart);if(c?.c&&c.r){const center=add(c.c,d.circleOffset||pt(0,0)),delta=sub(center,d.c);d.c=center;d.r=c.r;d.pos=add(d.pos,delta);if(c.curvePoints)d.curvePoints=c.curvePoints.map(p=>add(p,d.circleOffset||pt(0,0)));else delete d.curvePoints;if(c.type==='arc'){d.arcStart=c.startAngle;d.arcSweep=c.sweepAngle;}else{delete d.arcStart;delete d.arcSweep;}
   // 弦长与弧长都直接引用圆弧本身，几何随源圆弧变化
   if(d.kind==='chordLength'){const ends=arcEnds(d);if(ends){d.p1=ends[0];d.p2=ends[1];}}
  }else delete d.circleId;}for(const k of [1,2]){const ref=d['ref'+k];if(!ref)continue;const src=byId.get(ref.id),a=src&&referencePoint(src,ref);if(a)d['p'+k]=add(a,ref.offset||pt(0,0));else delete d['ref'+k];}
 for(const k of [1,2]){const spec=d['intersection'+k];if(spec){const p=resolveIntersection(spec,byId);if(p)d['p'+k]=p;else if(!byId.has(spec.line1.id)||!byId.has(spec.line2.id))delete d['intersection'+k];}}
 const pointIntersection=d.measurement?.pointIntersection;if(pointIntersection&&[pointIntersection.line1,pointIntersection.line2].some(r=>!byId.has(r.id)))delete d.measurement.pointIntersection;
 if(d.measurement){const measured=resolveMeasurement(d.measurement,byId);if(measured){d.p1=measured.p1;d.p2=measured.p2;if(measured.c)d.c=measured.c;}if(measured?.extensionSources)d.extensionSources=measured.extensionSources;else delete d.extensionSources;}
}return objects;}
function referencePoint(source,ref){if(ref.point&&Number.isInteger(ref.partIndex)){const part=geometryPart(source,ref.partIndex);return part&&(ref.point==='center'?part.c:ref.point==='start'?part.p1:ref.point==='end'?part.p3||part.p2:null);}return anchors(source)[ref.index];}
const measurementRefs=m=>m?['pointRef','line','line1','line2'].map(k=>m[k]).filter(Boolean):[];
const intersectionSpecs=d=>[d.intersection1,d.intersection2,d.measurement?.pointIntersection].filter(Boolean);
const intersectionRefs=d=>intersectionSpecs(d).flatMap(s=>[s.line1,s.line2]);
function resolveIntersection(spec,objects){
 if(!spec)return null;const byId=objects instanceof Map?objects:new Map(objects.map(o=>[o.id,o]));
 const edge=ref=>{const owner=byId.get(ref?.id);if(!owner)return null;const part=geometryPart(owner,ref.partIndex??ref.index);return part?.type==='line'?[part.p1,part.p2]:null;};
 const a=edge(spec.line1),b=edge(spec.line2),p=a&&b&&intersect(...a,...b);return p?add(p,spec.offset||pt(0,0)):null;
}
function projectToLine(p,[a,b]){const v=sub(b,a),length2=v.x*v.x+v.y*v.y;if(length2<1e-12)return null;const w=sub(p,a);return add(a,mul(v,(w.x*v.x+w.y*v.y)/length2));}
function filletBetween(first,second,radius){
 // 两条直边之间作圆角：求交点、角平分线上的圆心与两个切点
 if(!(radius>0))return null;
 const [a,b]=first,[c,d]=second,U=unit(sub(b,a)),V=unit(sub(d,c));
 if(len(U)<1e-6||len(V)<1e-6)return null;
 const den=U.x*V.y-U.y*V.x;if(Math.abs(den)<1e-6)return null;
 const t=((c.x-a.x)*V.y-(c.y-a.y)*V.x)/den,s=((c.x-a.x)*U.y-(c.y-a.y)*U.x)/den;
 const len1=len(sub(b,a)),len2=len(sub(d,c));
 // 两条边必须真的相交，否则谈不上圆角
 if(t<-1e-6||t>len1+1e-6||s<-1e-6||s>len2+1e-6)return null;
 const vertex=add(a,mul(U,t));
 // 交点把每条边分成两段，射线取背离交点的那一半
 const u1=t<=len1/2?U:mul(U,-1),u2=s<=len2/2?V:mul(V,-1);
 const half=Math.acos(Math.max(-1,Math.min(1,u1.x*u2.x+u1.y*u2.y)))/2;
 if(half<1e-3||half>Math.PI/2-1e-3)return null;
 const reach=radius/Math.tan(half),center=add(vertex,mul(unit(add(u1,u2)),radius/Math.sin(half)));
 const t1=add(vertex,mul(u1,reach)),t2=add(vertex,mul(u2,reach));
 const startAngle=Math.atan2(t1.y-center.y,t1.x-center.x)*180/Math.PI;
 let sweep=Math.atan2(t2.y-center.y,t2.x-center.x)*180/Math.PI-startAngle;
 while(sweep>180)sweep-=360;while(sweep<=-180)sweep+=360;
 return {vertex,center,r:radius,startAngle,sweep,t1,t2,reach,length1:len1,length2:len2};
}
function projectToSegment(p,[a,b]){const v=sub(b,a),length2=v.x*v.x+v.y*v.y;if(length2<1e-12)return null;const w=sub(p,a);const t=Math.max(0,Math.min(1,(w.x*v.x+w.y*v.y)/length2));return {p:add(a,mul(v,t)),t};}
function measurePointLine(p,line){const q=projectToLine(p,line);return q?{p1:{...p},p2:q}:null;}
function measureLines(first,second,station=.5){const u=sub(first[1],first[0]),v=sub(second[1],second[0]);if(len(u)<1e-6||len(v)<1e-6||Math.abs(u.x*v.y-u.y*v.x)>1e-6*len(u)*len(v))return null;return measurePointLine(add(first[0],mul(u,station)),second);}
function measureAngleLines(first,second,pos,signs){
 const [a,b]=first,[c,d]=second,u=sub(b,a),v=sub(d,c),den=u.x*v.y-u.y*v.x;
 if(len(u)<1e-8||len(v)<1e-8||Math.abs(den)<1e-7*len(u)*len(v))return null;
 const t=((c.x-a.x)*v.y-(c.y-a.y)*v.x)/den,center=add(a,mul(u,t)),U=unit(u),V=unit(v),q=unit(sub(pos||add(center,add(U,V)),center));
 let rays=signs;
 if(!rays){const acos=n=>Math.acos(Math.max(-1,Math.min(1,n)));for(const s of [-1,1])for(const r of [-1,1]){const A=mul(U,s),B=mul(V,r),span=acos(A.x*B.x+A.y*B.y),a=acos(q.x*A.x+q.y*A.y),b=acos(q.x*B.x+q.y*B.y);if(Math.abs(a+b-span)<1e-7)rays=[s,r];}if(!rays)rays=[1,1];}
 return {c:center,p1:add(center,mul(U,rays[0]*Math.max(10,len(u)))),p2:add(center,mul(V,rays[1]*Math.max(10,len(v)))),rays};
}
function resolveMeasurement(m,objects){const byId=objects instanceof Map?objects:new Map(objects.map(o=>[o.id,o]));const line=ref=>{const src=byId.get(ref?.id);if(!src)return null;const part=Number.isInteger(ref?.partIndex)?geometryPart(src,ref.partIndex):null,s=part?.type==='line'?[part.p1,part.p2]:segments(src)[ref.index];return s?s.map(p=>add(p,ref.offset||pt(0,0))):null;};
 if(m.mode==='line-length'){const s=line(m.line);return s?{p1:s[0],p2:s[1]}:null;}
 if(m.mode==='point-line'){const src=byId.get(m.pointRef?.id),anchor=src&&referencePoint(src,m.pointRef),p=resolveIntersection(m.pointIntersection,byId)||(anchor?add(anchor,m.pointRef.offset||pt(0,0)):m.point),s=line(m.line),measured=p&&s?measurePointLine(p,s):null;if(m.pointIntersection&&p)m.point={...p};return measured?{...measured,extensionSources:[null,s]}:null;}
 if(m.mode==='line-angle'){const a=line(m.line1),b=line(m.line2);return a&&b?measureAngleLines(a,b,null,[m.ray1||1,m.ray2||1]):null;}
 const a=line(m.line1),b=line(m.line2),measured=a&&b?measureLines(a,b,m.station):null;return measured?{...measured,extensionSources:[a,b]}:null;
}
// Keep a group rigid, including annotations that refer to a different group.
function translateGroup(objects,ids,delta){const moving=ids instanceof Set?ids:new Set(ids);if(!delta.x&&!delta.y)return objects;
 for(const d of objects.filter(o=>o.type==='dim')){const own=moving.has(d.id)?delta:pt(0,0);
  if(!intersectionSpecs(d).length)for(const key of ['ref1','ref2']){const ref=d[key];if(!ref)continue;const target=moving.has(ref.id)?delta:pt(0,0),adjust=sub(own,target);if(adjust.x||adjust.y)ref.offset=add(ref.offset||pt(0,0),adjust);}
  if(!d.measurement?.pointIntersection)for(const ref of measurementRefs(d.measurement)){const target=moving.has(ref.id)?delta:pt(0,0),adjust=sub(own,target);if(adjust.x||adjust.y)ref.offset=add(ref.offset||pt(0,0),adjust);}
  if(d.circleId){const target=moving.has(d.circleId)?delta:pt(0,0),adjust=sub(own,target);if(adjust.x||adjust.y)d.circleOffset=add(d.circleOffset||pt(0,0),adjust);}
 }
 for(const o of objects)if(moving.has(o.id))move(o,delta);
 return objects;
}
function isViewLabel(o){return o.type==='text'&&['主视图','俯视图','左视图'].includes(String(o.text||'').trim());}
const withoutViewLabels=objects=>objects.filter(o=>!isViewLabel(o));
function prepareDrawing(objects){return withoutViewLabels(objects).map(source=>{const o=clone(source);o.layer=o.type==='dim'?'dims':'drawing';if(['rect','poly','circle','arc','profile'].includes(o.type)&&o.style==='center')o.style='solid';delete o.sourceLayer;delete o.width;return o;});}
function withCornerMembers(objects,ids){const selected=new Set(ids),available=new Set(objects.map(o=>o.id));let changed=true;while(changed){changed=false;for(const o of objects)if(o.corner){const members=[o.id,o.corner.first.id,o.corner.second.id];if(members.every(id=>available.has(id))&&members.some(id=>selected.has(id)))for(const id of members)if(!selected.has(id)){selected.add(id);changed=true;}}}return selected;}
function withAttachedDimensions(objects,ids){const selected=withCornerMembers(objects,ids);for(const o of objects)if(o.type==='dim'&&(selected.has(o.ref1?.id)||selected.has(o.ref2?.id)||selected.has(o.circleId)||[...measurementRefs(o.measurement),...intersectionRefs(o)].some(r=>selected.has(r.id))))selected.add(o.id);return selected;}
function withViewGroups(objects,ids){const selected=new Set(ids),groups=new Set(objects.filter(o=>selected.has(o.id)&&o.viewGroup).map(o=>o.viewGroup));for(const o of objects)if(groups.has(o.viewGroup))selected.add(o.id);return withAttachedDimensions(objects,selected);}
function segments(o){if(o.type==='profile')return profileGeometry(o).segments;if(o.type==='line')return [[o.p1,o.p2]];if(o.type==='rect'){let p=anchors(o).slice(0,4);return p.map((a,i)=>[a,p[(i+1)%4]]);}if(o.type==='poly')return o.points.slice(0,o.closed?undefined:-1).map((a,i)=>[a,o.points[(i+1)%o.points.length]]);if(o.type==='path'){let p=null,start=null,out=[];for(const s of o.segments){if(s.cmd==='M'){p=transform(pt(...s.v),o.matrix);start=p;}else if(s.cmd==='L'){const q=transform(pt(...s.v),o.matrix);if(p)out.push([p,q]);p=q;}else if(s.cmd==='Z'){if(p&&start)out.push([p,start]);p=start;}else if(s.v.length)p=transform(pt(s.v.at(-2),s.v.at(-1)),o.matrix);}return out;}return [];}
function svgArcCenter(x1,y1,x2,y2,rx,ry,rotation,large,sweep){
 if(Math.abs(x1-x2)<1e-10&&Math.abs(y1-y2)<1e-10||rx<=0||ry<=0)return null;
 const phi=rotation*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi),dx=(x1-x2)/2,dy=(y1-y2)/2,px=cos*dx+sin*dy,py=-sin*dx+cos*dy;
 let scale=px*px/(rx*rx)+py*py/(ry*ry);if(scale>1){scale=Math.sqrt(scale);rx*=scale;ry*=scale;}
 const num=rx*rx*ry*ry-rx*rx*py*py-ry*ry*px*px,den=rx*rx*py*py+ry*ry*px*px,numScale=Math.max(1,rx*rx*ry*ry);if(num < -1e-8*numScale||den<=0)return null;
 const factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,num/den)),cxp=factor*rx*py/ry,cyp=-factor*ry*px/rx,cx=cos*cxp-sin*cyp+(x1+x2)/2,cy=sin*cxp+cos*cyp+(y1+y2)/2;
 const ux=(px-cxp)/rx,uy=(py-cyp)/ry,vx=(-px-cxp)/rx,vy=(-py-cyp)/ry,start=Math.atan2(uy,ux);
 let delta=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
 if(!sweep&&delta>0)delta-=Math.PI*2;if(sweep&&delta<0)delta+=Math.PI*2;
 return {c:pt(cx,cy),rx,ry,start,delta};
}
function circularPathPart(s,current,matrix=[1,0,0,1,0,0]){
 const [rx,ry,rotation,large,sweep,x,y]=s.v,end=pt(x,y),phi=rotation*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi),linear=p=>sub(transform(p,matrix),transform(pt(0,0),matrix)),u=linear(pt(rx*cos,rx*sin)),v=linear(pt(-ry*sin,ry*cos)),sx=len(u),sy=len(v),dot=u.x*v.x+u.y*v.y;
 if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<1e-10||sy<1e-10||Math.abs(sx-sy)>1e-6*Math.max(sx,sy)||Math.abs(dot)>1e-6*sx*sy)return null;
 const local=svgArcCenter(current.x,current.y,end.x,end.y,rx,ry,rotation,large,sweep);if(!local)return null;
 const center=transform(local.c,matrix),p1=transform(current,matrix),p3=transform(end,matrix),r=sx*local.rx/rx,determinant=matrix[0]*matrix[3]-matrix[1]*matrix[2],sweepAngle=local.delta*(determinant<0?-1:1),t=local.start+local.delta/2,ex=Math.cos(t)*local.rx,ey=Math.sin(t)*local.ry,middle=transform(add(local.c,pt(cos*ex-sin*ey,sin*ex+cos*ey)),matrix);
 return {type:'arc',c:center,r,p1,p2:middle,p3,startAngle:Math.atan2(p1.y-center.y,p1.x-center.x)*180/Math.PI,sweepAngle:sweepAngle*180/Math.PI};
}
function circularBezierPart(points){
 // CAD/SVG exporters often encode circular fillets as cubic Béziers. Keep the
 // original path and expose a radius only when its samples and tangents agree.
 const origin=points[0],size=Math.max(...points.map(p=>dist(p,origin)));if(size<1e-8)return null;
 const local=points.map(p=>mul(sub(p,origin),1/size)),at=t=>{let row=local;while(row.length>1)row=row.slice(1).map((p,i)=>add(mul(row[i],1-t),mul(p,t)));return row[0];},mid=at(.5),last=local.at(-1),fit=arcThrough(local[0],mid,last);
 if(!fit||!Number.isFinite(fit.r)||fit.r>1e4)return null;
 for(let i=0;i<=32;i++)if(Math.abs(dist(at(i/32),fit.c)-fit.r)>fit.r*.0005)return null;
 const tangents=[sub(local[1],local[0]),sub(last,local.at(-2))],ends=[local[0],last];
 for(let i=0;i<2;i++)if(len(tangents[i])<1e-8||Math.abs(unit(tangents[i]).x*unit(sub(ends[i],fit.c)).x+unit(tangents[i]).y*unit(sub(ends[i],fit.c)).y)>.002)return null;
 const part=normalizeArcPart({type:'arc',c:add(origin,mul(fit.c,size)),r:fit.r*size,p1:points[0],p2:add(origin,mul(mid,size)),p3:points.at(-1),sweep:fit.sweep,approximate:true});
 for(let i=1;i<32;i++){const p=add(origin,mul(at(i/32),size));if(dist(p,closestCurvePoint(p,part))>part.r*.0005)return null;}
 return part;
}
function geometryParts(o){
 const addIndex=parts=>parts.map((part,index)=>({...normalizeArcPart(part),index}));
 if(o.type==='line')return addIndex([{type:'line',p1:o.p1,p2:o.p2}]);
 if(o.type==='circle')return addIndex([{type:'circle',c:o.c,r:o.r}]);
 if(o.type==='arc'){const a=arcGeometry(o);return a?addIndex([{type:'arc',...a,...(o.c?{startAngle:o.startAngle,sweepAngle:o.sweepAngle}:{})}]):[];}
 if(o.type==='rect'){const p=anchors(o).slice(0,4);return addIndex(p.map((a,i)=>({type:'line',p1:a,p2:p[(i+1)%4]})));}
 if(o.type==='poly')return addIndex(o.points.slice(0,o.closed?undefined:-1).map((a,i)=>({type:'line',p1:a,p2:o.points[(i+1)%o.points.length]})));
 if(o.type==='profile')return addIndex(profileGeometry(o).parts);
 if(o.type==='path'){
  let current=null,start=null,previous='',control=null;const out=[];
  for(const s of o.segments){
   if(s.cmd==='M'){current=transform(pt(...s.v),o.matrix);start=current;previous='M';control=null;continue;}
   const end=transform(pt(s.v.at(-2),s.v.at(-1)),o.matrix);
   if(s.cmd==='L'||s.cmd==='Z'){const p2=s.cmd==='Z'?start:end;if(current&&p2)out.push({type:'line',p1:current,p2});current=p2;previous=s.cmd;control=null;continue;}
   if(s.cmd==='A'){const arc=circularPathPart(s,inverse(current,o.matrix),o.matrix);out.push(arc||{type:'ellipse',p1:current,p2:end,command:s.cmd,values:[...s.v]});current=end;previous='A';control=null;continue;}
   let controls=[];
   if(s.cmd==='C')controls=[transform(pt(s.v[0],s.v[1]),o.matrix),transform(pt(s.v[2],s.v[3]),o.matrix)];
   else if(s.cmd==='S')controls=[['C','S'].includes(previous)&&control?sub(mul(current,2),control):current,transform(pt(s.v[0],s.v[1]),o.matrix)];
   else if(s.cmd==='Q')controls=[transform(pt(s.v[0],s.v[1]),o.matrix)];
   else if(s.cmd==='T')controls=[['Q','T'].includes(previous)&&control?sub(mul(current,2),control):current];
   const arc=current&&controls.length?circularBezierPart([current,...controls,end]):null;
   out.push(arc||{type:'curve',p1:current,p2:end,command:s.cmd,values:[...s.v]});current=end;previous=s.cmd;control=controls.at(-1)||null;
  }
  return addIndex(out);
 }
 return [];
}
function sampledCircularPart(points){
 if(points.length<8)return null;
 const span=Math.max(...points.map(p=>dist(p,points[0])));if(span<1e-6)return null;
 const clean=points.filter((p,i)=>!i||dist(p,points[i-1])>span*1e-8);if(clean.length<8)return null;
 const closed=dist(clean[0],clean.at(-1))<span*1e-5,chain=closed?clean.slice(0,-1):clean;
 if(closed&&chain.length<12)return null;
 const origin=chain[0],local=chain.map(p=>mul(sub(p,origin),1/span)),cross=(a,b)=>a.x*b.y-a.y*b.x;
 let total=0;const lengths=[0];for(let i=1;i<local.length;i++){total+=dist(local[i-1],local[i]);lengths.push(total);}
 const atLength=f=>local[lengths.findIndex(n=>n>=total*f)];
 const fit=arcThrough(local[0],atLength(closed?1/3:.5),closed?atLength(2/3):local.at(-1));
 if(!fit||!Number.isFinite(fit.r))return null;
 let center=fit.c,radius=fit.r,method='circle';
 const radialError=(c,r)=>Math.max(...local.map(p=>Math.abs(dist(p,c)-r)));
 if(radialError(center,radius)>Math.max(1e-6,radius*.001)){
  // Some DXF fillets are dense polylines with eased curvature rather than a
  // mathematical circle. Infer their nominal corner from the end tangents;
  // retain every original node and expose this as an explicitly fitted arc.
  if(closed)return null;
  const end=local.at(-1),reach=.01,first=local.find(p=>dist(p,local[0])>=reach),last=local.slice().reverse().find(p=>dist(p,end)>=reach);
  if(!first||!last)return null;
  const a=unit(sub(first,local[0])),b=unit(sub(end,last)),na=pt(-a.y,a.x),nb=pt(-b.y,b.x),den=cross(na,nb);
  if(Math.abs(den)<.5)return null;
  center=add(local[0],mul(na,cross(sub(end,local[0]),nb)/den));
  const r1=dist(center,local[0]),r2=dist(center,end);radius=(r1+r2)/2;
  if(Math.abs(r1-r2)>radius*.02||radialError(center,radius)>radius*.075)return null;
  let turning=0,wrong=0;for(let i=2;i<local.length;i++){const u=unit(sub(local[i-1],local[i-2])),v=unit(sub(local[i],local[i-1])),angle=Math.atan2(cross(u,v),u.x*v.x+u.y*v.y);if(Math.abs(angle)>Math.PI/9)return null;turning+=angle;}
  for(let i=2;i<local.length;i++){const u=sub(local[i-1],local[i-2]),v=sub(local[i],local[i-1]),angle=Math.atan2(cross(u,v),u.x*v.x+u.y*v.y);if(angle*turning<0)wrong+=Math.abs(angle);}
  if(Math.abs(turning)<Math.PI/6||Math.abs(turning)>Math.PI*5/6||wrong>.12)return null;
  method='fillet';
 }
 let sweep=0;const samples=closed?[...local,local[0]]:local;
 for(let i=1;i<samples.length;i++){const a=sub(samples[i-1],center),b=sub(samples[i],center),angle=Math.atan2(cross(a,b),a.x*b.x+a.y*b.y);if(Math.abs(angle)>Math.PI/6||sweep&&angle*sweep< -1e-7)return null;sweep+=angle;}
 if(Math.abs(sweep)<Math.PI/9||closed&&Math.abs(Math.abs(sweep)-Math.PI*2)>.01)return null;
 return {type:closed?'circle':'arc',c:add(origin,mul(center,span)),r:radius*span,p1:chain[0],p2:chain[Math.floor(chain.length/2)],p3:chain.at(-1),startAngle:Math.atan2(local[0].y-center.y,local[0].x-center.x)*180/Math.PI,sweepAngle:sweep*180/Math.PI,curvePoints:closed?[...chain,chain[0]]:chain,approximate:true,fitMethod:method};
}
function circularParts(o){
 const parts=geometryParts(o),out=parts.filter(p=>p.type==='circle'||p.type==='arc');if(!['path','poly'].includes(o.type))return out;
 let chain=[],extra=0;const flush=()=>{const fitted=sampledCircularPart(chain);if(fitted)out.push({...fitted,index:parts.length+extra});extra++;chain=[];};
 for(const part of parts){if(part.type!=='line'){if(chain.length)flush();continue;}if(chain.length&&dist(chain.at(-1),part.p1)>1e-7)flush();if(!chain.length)chain.push(part.p1);chain.push(part.p2);}if(chain.length)flush();return out;
}
function geometryPart(o,index){return geometryParts(o).find(p=>p.index===index)||circularParts(o).find(p=>p.index===index)||null;}
function normalizeArcPart(part){if(part.type!=='arc')return part;const a=part.p1&&Math.atan2(part.p1.y-part.c.y,part.p1.x-part.c.x)*180/Math.PI,b=part.p3&&Math.atan2(part.p3.y-part.c.y,part.p3.x-part.c.x)*180/Math.PI,startAngle=Number.isFinite(part.startAngle)?part.startAngle:a,sweepAngle=Number.isFinite(part.sweepAngle)?part.sweepAngle:part.sweep?((b-a)%360+360)%360:-((a-b)%360+360)%360;return {...part,startAngle,sweepAngle};}
function closestCurvePoint(p,part){
 const delta=sub(p,part.c),radius=part.r;if(!(radius>0))return null;let u=len(delta)>1e-9?unit(delta):pt(1,0);
 if(part.curvePoints?.length>1){let nearest=null,error=Infinity;const cross=(a,b)=>a.x*b.y-a.y*b.x;
  for(let i=1;i<part.curvePoints.length;i++){const a=part.curvePoints[i-1],v=sub(part.curvePoints[i],a),w=sub(a,part.c),den=cross(u,v);if(Math.abs(den)<1e-12)continue;const t=cross(w,v)/den,s=cross(w,u)/den;if(t>=0&&s>=-1e-8&&s<=1+1e-8&&Math.abs(t-radius)<error){nearest=add(part.c,mul(u,t));error=Math.abs(t-radius);}}
  if(nearest)return nearest;const ends=[part.curvePoints[0],part.curvePoints.at(-1)];return dist(p,ends[0])<dist(p,ends[1])?ends[0]:ends[1];
 }
 if(part.type==='arc'){const arc=normalizeArcPart(part),angle=Math.atan2(u.y,u.x)*180/Math.PI,relative=arc.sweepAngle>=0?((angle-arc.startAngle)%360+360)%360:((arc.startAngle-angle)%360+360)%360;if(relative>Math.abs(arc.sweepAngle)+1e-7){const ends=[arc.p1||add(arc.c,pt(Math.cos(arc.startAngle*Math.PI/180)*radius,Math.sin(arc.startAngle*Math.PI/180)*radius)),arc.p3||add(arc.c,pt(Math.cos((arc.startAngle+arc.sweepAngle)*Math.PI/180)*radius,Math.sin((arc.startAngle+arc.sweepAngle)*Math.PI/180)*radius))];return ends.sort((a,b)=>dist(p,a)-dist(p,b))[0];}}
 return add(part.c,mul(u,radius));
}
function radiusLeaderPoint(p,curve){
 const delta=sub(p,curve.c),size=len(delta),forward=closestCurvePoint(p,curve);
 if(size<1e-8)return {p:forward,radial:true,reversed:false};
 const aligned=q=>{const v=sub(q,curve.c);return Math.abs(v.x*delta.y-v.y*delta.x)<1e-7*curve.r*size;};
 if(aligned(forward)&&(forward.x-curve.c.x)*delta.x+(forward.y-curve.c.y)*delta.y>0)return {p:forward,radial:true,reversed:false};
 const opposite=closestCurvePoint(sub(curve.c,delta),curve);
 if(aligned(opposite))return {p:opposite,radial:true,reversed:true};
 return {p:forward,radial:false,reversed:false};
}
function circlePart(source,index){if(!source)return null;if(index!=null){const part=geometryPart(source,index);return part&&(part.type==='circle'||part.type==='arc')?part:null;}if(source.type==='circle')return {type:'circle',c:source.c,r:source.r,index:0};if(source.type==='arc'){const a=arcGeometry(source);return a?{type:'arc',...a,index:0}:null;}return null;}
function explodeShape(o){
 const decomposable=['rect','poly','profile','path'];
 if(!decomposable.includes(o.type))return null;
 const parts=geometryParts(o);
 if(!parts.length||parts.some(part=>!['line','circle','arc'].includes(part.type)))return null;
 const objects=parts.map(part=>{
  let data;
  if(part.type==='line')data={p1:{...part.p1},p2:{...part.p2}};
  else if(part.type==='circle')data={c:{...part.c},r:part.r};
  else data={c:{...part.c},r:part.r,startAngle:part.startAngle,sweepAngle:part.sweepAngle};
  const object=shape(part.type,data,o.layer||'drawing',o.style||'solid');
  if(Number.isFinite(o.width))object.width=o.width;
  return object;
 });
 return {parts,objects};
}function arcThrough(a,m,b){const den=2*(a.x*(m.y-b.y)+m.x*(b.y-a.y)+b.x*(a.y-m.y));if(Math.abs(den)<1e-8)return null;const aa=a.x*a.x+a.y*a.y,mm=m.x*m.x+m.y*m.y,bb=b.x*b.x+b.y*b.y,c=pt((aa*(m.y-b.y)+mm*(b.y-a.y)+bb*(a.y-m.y))/den,(aa*(b.x-m.x)+mm*(a.x-b.x)+bb*(m.x-a.x))/den),r=dist(a,c),tau=2*Math.PI,norm=v=>(v%tau+tau)%tau,start=Math.atan2(a.y-c.y,a.x-c.x),end=Math.atan2(b.y-c.y,b.x-c.x),mid=Math.atan2(m.y-c.y,m.x-c.x),ccw=norm(end-start),sweep=norm(mid-start)<=ccw?1:0,angle=sweep?ccw:tau-ccw;return {c,r,sweep,large:angle>Math.PI?1:0,d:`M${a.x} ${a.y} A${r} ${r} 0 ${angle>Math.PI?1:0} ${sweep} ${b.x} ${b.y}`};}
function arcGeometry(o){if(o.c&&Number.isFinite(o.r)&&o.r>0&&Number.isFinite(o.startAngle)&&Number.isFinite(o.sweepAngle)&&Math.abs(o.sweepAngle)>1e-8&&Math.abs(o.sweepAngle)<360){const a=o.startAngle*Math.PI/180,s=o.sweepAngle*Math.PI/180,point=t=>add(o.c,pt(Math.cos(t)*o.r,Math.sin(t)*o.r)),p1=point(a),p2=point(a+s/2),p3=point(a+s),sweep=s>0?1:0,large=Math.abs(s)>Math.PI?1:0;return {c:o.c,r:o.r,p1,p2,p3,sweep,large,d:`M${p1.x} ${p1.y} A${o.r} ${o.r} 0 ${large} ${sweep} ${p3.x} ${p3.y}`};}if(!o.p1||!o.p2||!o.p3)return null;const arc=arcThrough(o.p1,o.p2,o.p3);return arc?{...arc,p1:o.p1,p2:o.p2,p3:o.p3}:null;}
function arcAngle(c,p){return Math.atan2(p.y-c.y,p.x-c.x)*180/Math.PI;}
// GB/T 4458.4 §4.1.5 的弦长标注需要圆弧两端点：整圆没有弦，返回 null。
function arcEnds(o){const span=arcDimensionSpan(o);if(!span)return null;const a=span.start*Math.PI/180,b=(span.start+span.sweep)*Math.PI/180;return [add(o.c,pt(Math.cos(a)*o.r,Math.sin(a)*o.r)),add(o.c,pt(Math.cos(b)*o.r,Math.sin(b)*o.r))];}
function onArcAt(o,angle){if(!o||!o.c||!(o.r>0)||!Number.isFinite(angle))return null;return add(o.c,pt(Math.cos(angle)*o.r,Math.sin(angle)*o.r));}
function arcFromCenter(c,start,end,direction=true){const r=dist(c,start);if(r<.05||dist(c,end)<.05)return null;const startAngle=Math.atan2(start.y-c.y,start.x-c.x)*180/Math.PI,endAngle=Math.atan2(end.y-c.y,end.x-c.x)*180/Math.PI,positive=((endAngle-startAngle)%360+360)%360;let sweepAngle;if(direction==='auto')sweepAngle=positive<=180?positive:positive-360;else if(direction==='cw'||direction===true)sweepAngle=positive;else sweepAngle=positive-360;if(Math.abs(sweepAngle)<1e-7||Math.abs(sweepAngle)>=360-1e-7)return null;return {c:{...c},r,startAngle,sweepAngle};}
function profileGeometry(o){const x=Math.min(o.p1.x,o.p2.x),y=Math.min(o.p1.y,o.p2.y),w=Math.abs(o.p2.x-o.p1.x),h=Math.abs(o.p2.y-o.p1.y),c=pt(x+w/2,y+h/2);let points=[],edges=[],parts=[],d='';
 const line=(p1,p2)=>parts.push({type:'line',p1,p2}),arc=(center,r,startAngle,sweepAngle,p1,p3)=>{const b=Math.PI*(startAngle+sweepAngle/2)/180;parts.push({type:'arc',c:center,r,startAngle,sweepAngle,p1,p2:add(center,pt(Math.cos(b)*r,Math.sin(b)*r)),p3});};
 if(o.profile==='slot'){
  if(w>=h){const r=h/2,a=pt(x+r,y),b=pt(x+w-r,y),e=pt(x+w-r,y+h),f=pt(x+r,y+h),right=pt(x+w-r,c.y),left=pt(x+r,c.y);d=`M${a.x} ${a.y}H${b.x}A${r} ${r} 0 0 1 ${e.x} ${e.y}H${f.x}A${r} ${r} 0 0 1 ${a.x} ${a.y}Z`;edges=[[a,b],[e,f]];parts=[{type:'line',p1:a,p2:b},{type:'arc',c:right,r,startAngle:-90,sweepAngle:180,p1:b,p2:pt(right.x+r,c.y),p3:e},{type:'line',p1:e,p2:f},{type:'arc',c:left,r,startAngle:90,sweepAngle:180,p1:f,p2:pt(left.x-r,c.y),p3:a}];points=[a,b,pt(x+w,c.y),e,f,pt(x,c.y),left,right];}
  else{const r=w/2,a=pt(x,y+r),b=pt(x,y+h-r),e=pt(x+w,y+h-r),f=pt(x+w,y+r),bottom=pt(c.x,y+h-r),top=pt(c.x,y+r);d=`M${a.x} ${a.y}V${b.y}A${r} ${r} 0 0 0 ${e.x} ${e.y}V${f.y}A${r} ${r} 0 0 0 ${a.x} ${a.y}Z`;edges=[[a,b],[e,f]];parts=[{type:'line',p1:a,p2:b},{type:'arc',c:bottom,r,startAngle:180,sweepAngle:-180,p1:b,p2:pt(bottom.x,bottom.y+r),p3:e},{type:'line',p1:e,p2:f},{type:'arc',c:top,r,startAngle:0,sweepAngle:-180,p1:f,p2:pt(top.x,top.y-r),p3:a}];points=[a,b,pt(c.x,y+h),e,f,pt(c.x,y),top,bottom];}
 }else if(o.profile==='roundrect'){const r=Math.min(o.radius||5,w/2,h/2);points=[pt(x+r,y),pt(x+w-r,y),pt(x+w,y+r),pt(x+w,y+h-r),pt(x+w-r,y+h),pt(x+r,y+h),pt(x,y+h-r),pt(x,y+r)];edges=[[points[0],points[1]],[points[2],points[3]],[points[4],points[5]],[points[6],points[7]]];parts=[{type:'line',p1:points[0],p2:points[1]},{type:'arc',c:pt(x+w-r,y+r),r,startAngle:-90,sweepAngle:90,p1:points[1],p2:pt(x+w-r+Math.cos(-45*Math.PI/180)*r,y+r+Math.sin(-45*Math.PI/180)*r),p3:points[2]},{type:'line',p1:points[2],p2:points[3]},{type:'arc',c:pt(x+w-r,y+h-r),r,startAngle:0,sweepAngle:90,p1:points[3],p2:pt(x+w-r+Math.cos(45*Math.PI/180)*r,y+h-r+Math.sin(45*Math.PI/180)*r),p3:points[4]},{type:'line',p1:points[4],p2:points[5]},{type:'arc',c:pt(x+r,y+h-r),r,startAngle:90,sweepAngle:90,p1:points[5],p2:pt(x+r+Math.cos(135*Math.PI/180)*r,y+h-r+Math.sin(135*Math.PI/180)*r),p3:points[6]},{type:'line',p1:points[6],p2:points[7]},{type:'arc',c:pt(x+r,y+r),r,startAngle:180,sweepAngle:90,p1:points[7],p2:pt(x+r+Math.cos(225*Math.PI/180)*r,y+r+Math.sin(225*Math.PI/180)*r),p3:points[0]}];d=`M${x+r} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x+r}A${r} ${r} 0 0 1 ${x} ${y+h-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`;}
 else{if(o.profile==='hexagon'){const r=Math.min(w/2,h/Math.sqrt(3));points=Array.from({length:6},(_,i)=>add(c,pt(Math.cos(i*Math.PI/3)*r,Math.sin(i*Math.PI/3)*r)));}else if(o.profile==='triangle')points=[pt(x,y+h),pt(x,y),pt(x+w,y+h)];else points=[pt(x+w*.25,y),pt(x+w*.75,y),pt(x+w,y+h),pt(x,y+h)];edges=points.map((p,i)=>[p,points[(i+1)%points.length]]);parts=edges.map(([p1,p2])=>({type:'line',p1,p2}));d='M'+points.map(p=>`${p.x} ${p.y}`).join('L')+'Z';}
 return {d,anchors:[...points,c],segments:edges,parts};
}
const snapGrid=(p,step=1)=>pt(round(Math.round(p.x/step)*step,6),round(Math.round(p.y/step)*step,6));
function normalizeSnaps(raw={}){const defaults={enabled:true,grid:true,object:true,intersection:false,projection:true,tolerance:3},out={...defaults};if(raw&&typeof raw==='object'){for(const key of ['enabled','grid','object','intersection','projection'])if(typeof raw[key]==='boolean')out[key]=raw[key];if(Number.isFinite(raw.tolerance))out.tolerance=round(Math.min(12,Math.max(3,raw.tolerance)),1);if(typeof raw.enabled!=='boolean'&&['object','intersection','projection'].every(key=>raw[key]===false))out.enabled=false;}return out;}
function snapMove(delta,opts={}){return opts.enabled!==false&&opts.grid!==false&&!opts.bypass?snapGrid(delta,opts.step||1):delta;}
function intersect(a,b,c,d){const u=sub(b,a),v=sub(d,c),den=u.x*v.y-u.y*v.x;if(Math.abs(den)<1e-9)return null;const w=sub(c,a),t=(w.x*v.y-w.y*v.x)/den,s=(w.x*u.y-w.y*u.x)/den;return t>=0&&t<=1&&s>=0&&s<=1?add(a,mul(u,t)):null;}
function snapCandidates(o){
 if(o.type==='dim'||o.type==='text')return [];
 // 优先级：0 端点/交点，1 圆心，2 象限点/圆弧中点，3 线段中点；低优先级候选只在更近时才吸附
 const out=[],push=(p,label,priority=0)=>out.push({p,label,priority});
 if(o.type==='circle'){push(o.c,'圆心',1);for(const p of anchors(o).slice(1))push(p,'象限点',2);}
 else if(o.type==='arc'){const a=arcGeometry(o);if(a){push(a.c,'圆心',1);push(a.p1,'圆弧端点',0);push(a.p3,'圆弧端点',0);push(a.p2,'圆弧中点',2);}}
 else for(const part of geometryParts(o)){
  if(part.type==='circle'||part.type==='arc'){push(part.c,'圆心',1);if(part.type==='arc'){push(part.p1,'圆弧端点',0);push(part.p3,'圆弧端点',0);}}
  else if(part.type==='line'){push(part.p1,'端点',0);push(part.p2,'端点',0);push(mul(add(part.p1,part.p2),.5),'中点',3);}
 }
 return out;
}
function snap(p,objects,opts={}){
 if(opts.enabled===false)return {p,label:'',snapped:false};
 const tol=Math.max(.05,opts.tolerance??2),candidates=[];
 if(opts.object!==false)for(const o of objects)candidates.push(...snapCandidates(o));
 if(opts.intersection){const ss=objects.flatMap(segments).slice(0,240);for(let i=0;i<ss.length;i++)for(let j=i+1;j<ss.length;j++){const q=intersect(...ss[i],...ss[j]);if(q)candidates.push({p:q,label:'交点',priority:0});}}
 const g=opts.step||1,onGrid=q=>Math.abs(q.x/g-Math.round(q.x/g))<1e-7&&Math.abs(q.y/g-Math.round(q.y/g))<1e-7;
 const usable=opts.forceGrid?candidates.filter(c=>onGrid(c.p)):candidates;
 // 中点、象限点只在更近时才吸附，避免稍微靠近就被吸走
 let best=null,bestDistance=Infinity;
 for(const c of usable){const reach=tol*(c.priority>=3?.62:c.priority===2?.78:1),d=dist(p,c.p);if(d<=reach&&d<bestDistance){best=c;bestDistance=d;}}
 if(best)return {p:opts.forceGrid?snapGrid(best.p,g):best.p,label:best.label,snapped:true};
 if(opts.grid||opts.forceGrid){const q=snapGrid(p,g);if(opts.forceGrid||dist(q,p)<=tol)return {p:q,label:`${fmt(g)} mm 网格`,snapped:true};}
 return {p,label:'',snapped:false};
}
function driveDimension(objects,d,value,scale=1){
 if(!d||d.type!=='dim'||!Number.isFinite(value)||value<=0||!Number.isFinite(scale)||scale<=0)return false;
 const pending=clone(objects),dimension=pending.find(o=>o.id===d.id);if(!dimension)return false;updateLinked(pending);
 if(!applyDimensionDrive(pending,dimension,value,scale))return false;
 const actual=dimValue(dimension,scale);if(!Number.isFinite(actual)||Math.abs(actual-value)>Math.max(1e-6,value*1e-7))return false;
 for(let i=0;i<objects.length;i++)if(JSON.stringify(objects[i])!==JSON.stringify(pending[i])){for(const key of Object.keys(objects[i]))delete objects[i][key];Object.assign(objects[i],pending[i]);}
 return true;
}
function fitShapeDimension(source,d,target){
 const original=clone(source),points=anchors(original);if(!points.length)return null;
 const parameterized=['rect','profile'].includes(source.type),origin=parameterized?original.p1:pt(Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y))),w=parameterized?Math.abs(original.p2.x-original.p1.x):Math.max(...points.map(p=>p.x))-origin.x,h=parameterized?Math.abs(original.p2.y-original.p1.y):Math.max(...points.map(p=>p.y))-origin.y;
 const candidate=(axis,value)=>{
  const sx=axis==='uniform'?value:axis==='x'?value/w:1,sy=axis==='uniform'?value:axis==='y'?value/h:1;if(!(sx>0&&sy>0)||Math.max(sx,sy)>1e6)return null;
  const copy=clone(original),map=p=>pt(origin.x+(p.x-origin.x)*sx,origin.y+(p.y-origin.y)*sy);
  if(parameterized){copy.p2=map(copy.p2);if(copy.profile==='roundrect'){const r=Math.min(original.radius||5,w/2,h/2)*(axis==='uniform'?value:1);if(r>Math.min(w*sx,h*sy)/2+1e-7)return null;copy.radius=r;}if(copy.profile==='slot'&&((w>=h&&w*sx<h*sy-1e-7)||(w<h&&w*sx>h*sy+1e-7)))return null;}
  else if(copy.type==='poly')copy.points=copy.points.map(map);
  else if(copy.type==='path'){const [a,b,c,d,e,f]=copy.matrix||[1,0,0,1,0,0];copy.matrix=[a*sx,b*sy,c*sx,d*sy,e*sx+origin.x*(1-sx),f*sy+origin.y*(1-sy)];}
  return copy;
 };
 const measure=shape=>{if(!shape)return NaN;const dim=clone(d);updateLinked([shape,dim]);return dimValue(dim,1);},current=measure(original),v=sub(d.p2,d.p1),curvedPath=source.type==='path'&&geometryParts(source).some(p=>p.type!=='line'),axes=curvedPath?['uniform']:d.kind==='horizontal'?['x','y','uniform']:d.kind==='vertical'?['y','x','uniform']:Math.abs(v.y)<1e-7?['x','y','uniform']:Math.abs(v.x)<1e-7?['y','x','uniform']:['uniform','x','y'];
 for(const axis of axes){const initial=axis==='uniform'?1:axis==='x'?w:h;if(!(initial>1e-8))continue;let a=initial,fa=current,b=initial+Math.max(.1,initial*.05),shape=candidate(axis,b);if(!shape){b=initial*.95;shape=candidate(axis,b);}let fb=measure(shape);
  for(let i=0;i<10&&Number.isFinite(fb);i++){if(Math.abs(fb-target)<=Math.max(1e-7,target*1e-8))return shape;const slope=(fb-fa)/(b-a);if(!Number.isFinite(slope)||Math.abs(slope)<1e-9)break;const next=b+(target-fb)/slope;a=b;fa=fb;b=next;shape=candidate(axis,b);fb=measure(shape);}
 }
 return null;
}
function applyDimensionDrive(objects,d,value,scale){
 const byId=new Map(objects.map(o=>[o.id,o])),target=value*scale,current=dimValue(d,1);if(!(current>1e-8))return false;
 if(d.kind==='angle'&&d.measurement?.mode==='line-angle'){
  const source=byId.get(d.measurement.line2.id);if(source?.type!=='line'||value>=180)return false;
  const a=unit(sub(d.p1,d.c)),b=unit(sub(d.p2,d.c)),turn=Math.sign(a.x*b.y-a.y*b.x)||1,desired=Math.atan2(a.y,a.x)+turn*value*Math.PI/180-(d.measurement.ray2===-1?Math.PI:0),actual=Math.atan2(source.p2.y-source.p1.y,source.p2.x-source.p1.x),angle=desired-actual,pivot=sub(d.c,d.measurement.line2.offset||pt(0,0)),rotate=p=>{const v=sub(p,pivot);return add(pivot,pt(v.x*Math.cos(angle)-v.y*Math.sin(angle),v.x*Math.sin(angle)+v.y*Math.cos(angle)));};
  source.p1=rotate(source.p1);source.p2=rotate(source.p2);d.override='';updateLinked(objects);return true;
 }
 if(d.kind==='radius'||d.kind==='diameter'){
  const source=byId.get(d.circleId),part=circlePart(source,d.circlePart),radius=d.kind==='diameter'?target/2:target;if(!part||!(radius>1e-5))return false;
  if(source.type==='circle')source.r=radius;
  else if(source.type==='arc'){Object.assign(source,{c:{...part.c},r:radius,startAngle:part.startAngle,sweepAngle:part.sweepAngle});delete source.p1;delete source.p2;delete source.p3;}
  else if(source.type==='profile'&&source.profile==='roundrect'){if(radius>Math.min(Math.abs(source.p2.x-source.p1.x),Math.abs(source.p2.y-source.p1.y))/2)return false;source.radius=radius;}
  else if(source.type==='profile'&&source.profile==='slot'){const horizontal=Math.abs(source.p2.x-source.p1.x)>=Math.abs(source.p2.y-source.p1.y),axis=horizontal?'y':'x',other=horizontal?'x':'y';if(radius*2>Math.abs(source.p2[other]-source.p1[other]))return false;source.p2[axis]=source.p1[axis]+(Math.sign(source.p2[axis]-source.p1[axis])||1)*radius*2;}
  else return false;
  d.override='';updateLinked(objects);return true;
 }
 const ownedRefs=[d.ref1,d.ref2,...measurementRefs(d.measurement)].filter(Boolean),sameOwner=ownedRefs.length&&ownedRefs.every(ref=>ref.id===ownedRefs[0].id),complete=ownedRefs.length>=2||d.measurement?.mode==='line-length';
 if(d.kind!=='angle'&&sameOwner&&complete){const source=byId.get(ownedRefs[0].id);if(source&&['rect','profile','poly','path'].includes(source.type)){const fitted=fitShapeDimension(source,d,target);if(!fitted)return false;Object.assign(source,fitted);d.override='';updateLinked(objects);return true;}}
 if(d.measurement?.mode==='line-length'){const ref=d.measurement.line,source=byId.get(ref.id);if(!source||source.type!=='line')return false;const delta=sub(source.p2,source.p1);if(Number.isFinite(d.axisAngle))source.p2=add(source.p1,mul(delta,target/current));else if(d.kind==='horizontal')source.p2.x=source.p1.x+(Math.sign(delta.x)||1)*target;else if(d.kind==='vertical')source.p2.y=source.p1.y+(Math.sign(delta.y)||1)*target;else source.p2=add(source.p1,mul(unit(delta),target));d.override='';updateLinked(objects);return true;}
 const refs=[d.ref1,d.ref2].filter(Boolean);
 if(refs.length===2&&refs[0].id===refs[1].id){
  const source=byId.get(refs[0].id);if(!source)return false;
  if(source.type==='line'){if(new Set(refs.map(r=>r.index)).size!==2||refs.some(r=>r.index>1))return false;
   const delta=sub(source.p2,source.p1);if(Number.isFinite(d.axisAngle))source.p2=add(source.p1,mul(delta,target/current));else if(d.kind==='horizontal')source.p2.x=source.p1.x+(Math.sign(delta.x)||1)*target;else if(d.kind==='vertical')source.p2.y=source.p1.y+(Math.sign(delta.y)||1)*target;else source.p2=add(source.p1,mul(unit(delta),target));
   d.override='';updateLinked(objects);return true;
  }
  if((source.type==='rect'||source.type==='profile')&&(d.kind==='horizontal'||d.kind==='vertical')){
   const axis=d.kind==='horizontal'?'x':'y',currentExtent=Math.abs(source.p2[axis]-source.p1[axis]);if(Math.abs(currentExtent-current)>.02)return false;
   const sign=Math.sign(source.p2[axis]-source.p1[axis])||1;source.p2[axis]=source.p1[axis]+sign*target;
   d.override='';updateLinked(objects);return true;
  }
 }
 if(refs.length===2){
  const source=byId.get(refs[1].id);if(!source||['rect','profile','poly','path'].includes(source.type)&&refs[0].id===refs[1].id)return false;
  let direction;
  if(d.kind==='horizontal')direction=pt(Math.sign(d.p2.x-d.p1.x)||1,0);
  else if(d.kind==='vertical')direction=pt(0,Math.sign(d.p2.y-d.p1.y)||1);
  else direction=unit(sub(d.p2,d.p1));
  move(source,mul(direction,target-current));d.override='';updateLinked(objects);return true;
 }
 if(d.measurement?.mode==='line-line'){
  const source=byId.get(d.measurement.line2?.id);if(!source)return false;const direction=unit(sub(d.p2,d.p1));move(source,mul(direction,target-current));d.override='';updateLinked(objects);return true;
 }
 if(d.measurement?.mode==='point-line'){
  const source=byId.get(d.measurement.pointRef?.id),lineSource=byId.get(d.measurement.line?.id),direction=unit(sub(d.p2,d.p1));if(source)move(source,mul(direction,current-target));else if(lineSource)move(lineSource,mul(direction,target-current));else return false;d.override='';updateLinked(objects);return true;
 }
 return false;
}function dimensionAxis(o){if(!['horizontal','vertical'].includes(o.kind))return null;const a=((o.axisAngle||0)+(o.kind==='vertical'?90:0))*Math.PI/180,clean=n=>Math.abs(n)<1e-12?0:Math.abs(Math.abs(n)-1)<1e-12?Math.sign(n):n;return pt(clean(Math.cos(a)),clean(Math.sin(a)));}
// GB/T 4458.4 §5.3：弧长尺寸需要圆弧的起止角；整圆没有弧长标注。
function arcDimensionSpan(o){
 const pick=(...keys)=>{for(const key of keys)if(Number.isFinite(o[key]))return o[key];return null;};
 const start=pick('arcStart','startAngle'),sweep=pick('arcSweep','sweepAngle');
 return start!=null&&sweep!=null&&Math.abs(sweep)>1e-7?{start,sweep}:null;
}
// GB/T 4458.4 §4.1.5：弧长的尺寸界线平行于该弧所对弦的垂直平分线，弧度较大时沿径向引出。
function arcLeaderDirection(o,span){
 const declared=o&&o.arcLeader;if(declared==='radial'||declared==='perpendicular')return declared;
 return Math.abs(span.sweep)>150?'radial':'perpendicular';
}
function arcLeaderTarget(c,radius,point,direction){
 if(direction){const v=sub(point,c),k=v.x*direction.x+v.y*direction.y,disc=k*k-(dist(point,c)**2-radius*radius);if(disc>=0){const t=-k+Math.sqrt(disc);if(t>1e-6)return add(point,mul(direction,t));}}
 return add(c,mul(unit(sub(point,c)),radius));
}
function dimValue(o,scale=1){
 if(o.kind==='diameter'||o.kind==='radius')return (o.kind==='diameter'?2:1)*o.r/scale;
 if(o.kind==='arcLength'){const span=arcDimensionSpan(o);return span?o.r*Math.abs(span.sweep)*Math.PI/180/scale:0;}
 // GB/T 4458.4 §4.1.5：弦长取圆弧两端点的直线距离，不随尺寸线位置变化。
 if(o.kind==='chordLength'){const span=arcDimensionSpan(o);return span?2*o.r*Math.abs(Math.sin(span.sweep*Math.PI/360))/scale:0;}
 if(o.kind==='angle'){let a=Math.atan2(o.p1.y-o.c.y,o.p1.x-o.c.x),b=Math.atan2(o.p2.y-o.c.y,o.p2.x-o.c.x);let n=((b-a)*180/Math.PI+360)%360;return n>180?360-n:n;}
 const axis=dimensionAxis(o),v=sub(o.p2,o.p1);return (axis?Math.abs(v.x*axis.x+v.y*axis.y):dist(o.p1,o.p2))/scale;
}
function dimLabel(o,scale=1,blank=false){
 const automatic=o.autoSymbols!==false,spherical=automatic&&o.spherical===true;
 const symbol=automatic?(o.kind==='diameter'?spherical?'S⌀':'⌀':o.kind==='radius'?spherical?'SR':'R':o.kind==='arcLength'?'⌒':''):'';
 let text=blank?'(     )':o.override!==''&&o.override!=null?o.override:fmt(dimValue(o,scale));
 // GB/T 4458.4 §5.4：参考尺寸的尺寸数字加圆括弧。
 if(!blank&&o.reference===true&&!/^[(（].*[)）]$/.test(text))text='('+text+')';
 return symbol+text+(automatic&&o.kind==='angle'?'°':'')+(o.suffix||'');
}
function arrow(p,dir,size=2.4){
 const u=unit(dir),v=pt(-u.y,u.x),a=add(p,mul(u,size)),b=mul(v,size*.28),d=`M${p.x},${p.y} L${add(a,b).x},${add(a,b).y} L${sub(a,b).x},${sub(a,b).y} Z`;
 // A wider solid head stays joined to the dimension line without erasing any contour.
 return `<path d="${d}" fill="currentColor" stroke="none"/>`;
}
const ln=(a,b,attrs='')=>`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${attrs}/>`;
function textAt(p,s,size=3.5,angle=0,attrs=''){return `<text x="${p.x}" y="${p.y}" transform="rotate(${angle} ${p.x} ${p.y})" text-anchor="middle" font-size="${size}" fill="currentColor" stroke="none" font-family="Times New Roman, SimSun, serif" ${attrs}>${esc(s)}</text>`;}
function editedPart(base,edit={}){
 const part={...base},offset=edit.offset||pt(0,0),a=(edit.angle||0)*Math.PI/180,k=edit.scale||1;
 const rotate=v=>pt((v.x*Math.cos(a)-v.y*Math.sin(a))*k,(v.x*Math.sin(a)+v.y*Math.cos(a))*k);
 part.hidden=!!edit.hidden;part.style=edit.style||'thin';if(Number.isFinite(edit.width)&&edit.width>0)part.width=edit.width;
 if(part.type==='line'){const center=mul(add(base.p1,base.p2),.5);part.p1=add(add(add(center,rotate(sub(base.p1,center))),offset),edit.start||pt(0,0));part.p2=add(add(add(center,rotate(sub(base.p2,center))),offset),edit.end||pt(0,0));part.point=mul(add(part.p1,part.p2),.5);part.handles={start:part.p1,end:part.p2};}
 else if(part.type==='arrow'){part.p=add(base.p,offset);part.dir=unit(rotate(base.dir));part.size=base.size*k;part.point=part.p;part.handles={direction:add(part.p,mul(part.dir,part.size*2.5))};}
 else if(part.type==='arc'){part.c=add(base.c,offset);part.r=base.r*k;part.a=base.a+a;part.b=base.b+a;part.point=add(part.c,pt(Math.cos((part.a+part.b)/2)*part.r,Math.sin((part.a+part.b)/2)*part.r));part.handles={radius:add(part.c,pt(Math.cos(part.b)*part.r,Math.sin(part.b)*part.r))};}
 return part;
}
function dimension(o,{scale=1,font=3.5,blank=false,layout=false,partsOnly=false}={}){
 // Custom numbers and blank labels must not rearrange dimension lines or arrows.
 const numberSize=Number.isFinite(o.textSize)&&o.textSize>0?o.textSize:font,label=dimLabel(o,scale,blank),layoutLabel=dimLabel({...o,override:''},scale),overhang=Number.isFinite(o.extension)?o.extension:2,numberGap=1.2,leaderLength=Number.isFinite(o.leaderLength)&&o.leaderLength>=0?o.leaderLength:null,parts=[];let labelP,textAngle=0;
 const line=(id,p1,p2)=>parts.push({id,type:'line',p1,p2});
 const head=(id,p,dir)=>parts.push({id,type:'arrow',p,dir,size:2.4});
 const drawLabel=(p,angle=0)=>{labelP=add(p,o.textOffset||pt(0,0));textAngle=Number.isFinite(o.textAngle)?o.textAngle:angle;parts.push({id:'number',type:'text',point:labelP,angle:textAngle,font:numberSize,label,hidden:!!o.hideText});};
 if(o.kind==='diameter'&&['auto','inside','outside','leader','horizontal','vertical'].includes(o.diameterStyle)){
  const delta=sub(o.pos,o.c),mode=o.diameterStyle==='auto'?(len(delta)<=o.r?'inside':Math.abs(delta.x)<o.r*.4?'horizontal':Math.abs(delta.y)<o.r*.4?'vertical':len(delta)>o.r+18?'leader':'outside'):o.diameterStyle,u=len(delta)>1e-8?unit(delta):pt(1,0),start=sub(o.c,mul(u,o.r)),end=add(o.c,mul(u,o.r));
  let angle=Math.atan2(u.y,u.x)*180/Math.PI;if(angle>=90)angle-=180;if(angle< -90)angle+=180;
  const normal=pt(Math.sin(angle*Math.PI/180),-Math.cos(angle*Math.PI/180));
  if(mode==='horizontal'||mode==='vertical'){
   const horizontal=mode==='horizontal',angle=(o.axisAngle||0)*Math.PI/180,axis=horizontal?pt(Math.cos(angle),Math.sin(angle)):pt(-Math.sin(angle),Math.cos(angle)),a=sub(o.c,mul(axis,o.r)),b=add(o.c,mul(axis,o.r)),normal=pt(-axis.y,axis.x),offset=delta.x*normal.x+delta.y*normal.y,p=add(a,mul(normal,offset)),q=add(b,mul(normal,offset));
   for(const [id,origin,target] of [['extension1',a,p],['extension2',b,q]])line(id,origin,add(target,mul(unit(sub(target,origin)),overhang)));
   line('line',p,q);head('arrow1',p,axis);head('arrow2',q,mul(axis,-1));drawLabel(add(mul(add(p,q),.5),mul(normal,horizontal?-numberGap:numberGap)),(o.axisAngle||0)+(horizontal?0:-90));
  }else if(mode==='inside'){
   line('line',start,end);head('arrow1',start,u);head('arrow2',end,mul(u,-1));drawLabel(add(o.c,mul(normal,numberGap)),angle);
  }else{
   const textWidth=Math.max(6,layoutLabel.length*numberSize*.6+2),reach=leaderLength!=null?o.r+leaderLength:Math.max(o.r+5,dist(o.c,o.pos)),elbow=add(o.c,mul(u,reach));
   head('arrow1',start,mul(u,-1));head('arrow2',end,u);
   if(mode==='outside'){const tail=leaderLength!=null?leaderLength:Math.max(textWidth,reach-o.r),tip=add(end,mul(u,tail));line('line',sub(start,mul(u,4)),tip);drawLabel(add(add(end,mul(u,tail/2)),mul(normal,numberGap)),angle);}
   else{const side=u.x<0?-1:1,shelf=add(elbow,pt(side*textWidth,0));line('line',sub(start,mul(u,4)),elbow);line('leader',elbow,shelf);drawLabel(add(mul(add(elbow,shelf),.5),pt(0,-numberGap)));}
  }
 }else if(o.kind==='radius'&&['auto','outside','leader','inside','short','short-leader'].includes(o.radiusStyle)){
  const mode=o.radiusStyle,delta=sub(o.pos,o.c),curve={...(Number.isFinite(o.arcStart)&&Number.isFinite(o.arcSweep)?{type:'arc',c:o.c,r:o.r,startAngle:o.arcStart,sweepAngle:o.arcSweep}:{type:'circle',c:o.c,r:o.r}),curvePoints:o.curvePoints},target=radiusLeaderPoint(o.pos,curve),internal=len(delta)<=dist(target.p,o.c)||target.reversed,end=internal||mode==='inside'?target.p:closestCurvePoint(o.pos,curve),u=unit(sub(end,o.c)),textWidth=Math.max(6,layoutLabel.length*numberSize*.6+2),side=delta.x<0?-1:1;
  let angle=Math.atan2(u.y,u.x)*180/Math.PI;if(angle>=90)angle-=180;if(angle< -90)angle+=180;
  const normal=pt(Math.sin(angle*Math.PI/180),-Math.cos(angle*Math.PI/180));
  if(mode==='inside'||internal){
   const bent=mode==='inside'||mode==='leader'||mode==='short-leader'||!target.radial;
   if(!bent){const along=delta.x*u.x+delta.y*u.y,start=mode==='short'?o.pos:add(o.c,mul(u,Math.min(0,along)));line('line',start,end);head('arrow1',end,mul(u,-1));drawLabel(add(o.pos,mul(normal,numberGap)),angle);}
   else{
    let elbow=add(o.pos,pt((end.x<o.pos.x?-1:1)*textWidth/2,numberGap)),anchor=radiusLeaderPoint(elbow,curve),tip=anchor.p,direction=unit(sub(tip,o.c));
    if(!anchor.radial){if(Math.abs(direction.y)<1e-8&&curve.type==='arc'){const mid=(curve.startAngle+curve.sweepAngle/2)*Math.PI/180;tip=add(curve.c,pt(Math.cos(mid)*curve.r,Math.sin(mid)*curve.r));direction=unit(sub(tip,o.c));}if(Math.abs(direction.y)>1e-8)elbow=add(o.c,mul(direction,(elbow.y-o.c.y)/direction.y));}
    const shelf=pt(o.pos.x+(o.pos.x<elbow.x?-1:1)*textWidth/2,elbow.y),arrowDirection=dist(elbow,tip)>1e-8?unit(sub(elbow,tip)):mul(direction,-1);
    line('line',tip,elbow);head('arrow1',tip,arrowDirection);line('leader',elbow,shelf);drawLabel(o.pos);
   }
  }else if(mode==='auto'){
   let elbow=add(o.pos,pt(-side*textWidth/2,numberGap)),tip=closestCurvePoint(elbow,curve),direction=unit(sub(tip,o.c)),t=Math.abs(direction.y)>1e-8?(elbow.y-o.c.y)/direction.y:-1;
    if(t>o.r+1){if(leaderLength!=null)t=o.r+leaderLength;elbow=add(o.c,mul(direction,t));const labelX=side>0?Math.max(o.pos.x,elbow.x+textWidth/2):Math.min(o.pos.x,elbow.x-textWidth/2),shelf=pt(labelX+side*textWidth/2,elbow.y);line('line',o.c,elbow);head('arrow1',tip,direction);line('leader',elbow,shelf);drawLabel(pt(labelX,elbow.y-numberGap));}
    else{const tail=leaderLength!=null?leaderLength:Math.max(textWidth,len(delta)-o.r),far=add(end,mul(u,tail));line('line',o.c,far);head('arrow1',end,u);drawLabel(add(add(end,mul(u,tail/2)),mul(normal,numberGap)),angle);}
  }else{
   const straight=mode==='outside'||mode==='short',tail=leaderLength!=null?leaderLength:Math.max(straight?textWidth:4,dist(o.c,o.pos)-o.r),elbow=add(end,mul(u,tail));
   line('line',mode==='short'||mode==='short-leader'?end:o.c,elbow);head('arrow1',end,u);
   if(straight)drawLabel(add(add(end,mul(u,tail/2)),mul(normal,numberGap)),angle);
   else{const shelf=add(elbow,pt(side*textWidth,0));line('leader',elbow,shelf);drawLabel(add(mul(add(elbow,shelf),.5),pt(0,-numberGap)));}
  }
 }else if(o.kind==='diameter'||o.kind==='radius'){
  const u=unit(sub(o.pos,o.c)),end=add(o.c,mul(u,o.r));
  if(o.kind==='diameter'){const start=sub(o.c,mul(u,o.r));line('line',start,end);head('arrow1',start,u);head('arrow2',end,mul(u,-1));}
  else{line('line',o.c,end);head('arrow1',end,mul(u,-1));}
  line('leader',end,o.pos);drawLabel(add(o.pos,pt(layoutLabel.length*.8,-numberGap)));
 }else if(o.kind==='arcLength'){
  // GB/T 4458.4 §4.1.5 + §5.3：尺寸线画成与被注弧同心的圆弧，尺寸界线平行于该弧所对弦的垂直平分线引出
  //（弧度较大时可沿径向引出），尺寸数字加注符号“⌒”。弧太短或无处画尺寸弧时退化为引出线。
  const span=arcDimensionSpan(o),anchors=span?arcEnds(o):null,radius=o.r;
  const bend=span?Math.abs(span.sweep):0,dirSign=span&&span.sweep<0?-1:1;
  const reach=dist(o.c,o.pos),offset=Math.abs(reach-radius)>0.6?reach-radius:Math.max(4,layoutLabel.length*numberSize*.5+3);
  const r2=radius+offset;
  const fitted=anchors&&bend>=12&&bend<352&&r2>0.5?(()=>{
   // 弦的垂直平分线方向：圆心指向弦中点；弧度大时按 §4.1.5 改为各自的径向
   const chordMid=mul(add(anchors[0],anchors[1]),.5),bisector=unit(sub(chordMid,o.c))||pt(0,-1);
   const dirs=arcLeaderDirection(o,span)==='radial'?[unit(sub(anchors[0],o.c)),unit(sub(anchors[1],o.c))]:[bisector,bisector];
   const P=arcLeaderTarget(o.c,r2,anchors[0],dirs[0]),Q=arcLeaderTarget(o.c,r2,anchors[1],dirs[1]);
   if(!P||!Q||dist(P,Q)<1e-6)return null;
   for(const [id,from,target,direction] of [['extension1',anchors[0],P,dirs[0]],['extension2',anchors[1],Q,dirs[1]]]){
    // 尺寸界线从被注弧端点引出，越过尺寸线后再超出一小段（§4.1.1）
    line(id,from,add(from,mul(direction,dist(from,target)+overhang)));
   }
   return [P,Q];
  })():null;
  if(fitted){
   const [P,Q]=fitted;
   const a=Math.atan2(P.y-o.c.y,P.x-o.c.x),b=Math.atan2(Q.y-o.c.y,Q.x-o.c.x);
   // 尺寸弧必须与被注弧同向：按被注弧的转向取 a→b 的正向夹角，可能大于 180°
   const turn=dirSign*((dirSign>0?b-a:a-b)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
   parts.push({id:'arc',type:'arc',c:{...o.c},r:r2,a,b,sweep:turn});
   head('arrow1',P,pt(-Math.sin(a)*dirSign,Math.cos(a)*dirSign));
   head('arrow2',Q,pt(Math.sin(b)*dirSign,-Math.cos(b)*dirSign));
   const mid=a+turn/2,gap=numberGap+layoutLabel.length*numberSize*.34;
   const tangent=pt(-Math.sin(mid)*dirSign,Math.cos(mid)*dirSign);
   let angle=Math.atan2(tangent.y,tangent.x)*180/Math.PI;if(angle>=90)angle-=180;if(angle< -90)angle+=180;
   // 数字放在尺寸弧外侧（尺寸弧在被注弧内侧时放在更内侧）
   const labelR=r2+Math.sign(offset||1)*gap;
   drawLabel(add(o.c,pt(Math.cos(mid)*labelR,Math.sin(mid)*labelR)),angle);
  }else{
   // 弧度太小：按引出线注在弧外，箭头仍指在被注弧上
   const from=onArcAt(o,(span?span.start+span.sweep/2:0)*Math.PI/180)||onArcAt(o,0)||o.pos;
   const outward=unit(mul(unit(sub(from,o.c)),-1))||pt(0,-1);
   const textWidth=Math.max(6,layoutLabel.length*numberSize*.6+2),shoe=add(from,mul(outward,leaderLength!=null?leaderLength:textWidth+4));
   head('arrow1',from,outward);line('line',from,shoe);
   drawLabel(add(shoe,mul(outward,textWidth/2+numberGap)),0);
  }
 }else if(o.kind==='chordLength'){
  // GB/T 4458.4 §4.1.5：弦长的尺寸线为直线、平行于弦，尺寸界线平行于该弦的垂直平分线。
  const ends=arcEnds(o)||[o.p1,o.p2].filter(Boolean);
  if(ends.length===2){
   const chord=unit(sub(ends[1],ends[0])),normal=pt(-chord.y,chord.x),mid=mul(add(ends[0],ends[1]),.5);
   const side=((o.pos.x-mid.x)*normal.x+(o.pos.y-mid.y)*normal.y)>=0?1:-1;
   const off=Math.max(0,Math.abs((o.pos.x-mid.x)*normal.x+(o.pos.y-mid.y)*normal.y))*side;
   const a=add(ends[0],mul(normal,off)),b=add(ends[1],mul(normal,off));
   const d=off>=0?normal:mul(normal,-1);
   for(const [id,from,to] of [['extension1',ends[0],a],['extension2',ends[1],b]])line(id,from,add(from,mul(d,dist(from,to)+overhang)));
   let angle=Math.atan2(chord.y,chord.x)*180/Math.PI;if(angle>=90)angle-=180;if(angle< -90)angle+=180;
   const labelNormal=pt(Math.sin(angle*Math.PI/180),-Math.cos(angle*Math.PI/180));
   line('line',a,b);head('arrow1',a,chord);head('arrow2',b,mul(chord,-1));
   drawLabel(add(mul(add(a,b),.5),mul(labelNormal,numberGap)),angle);
  }
 }else if(o.kind==='angle'){
  const r=dist(o.c,o.pos);let a=Math.atan2(o.p1.y-o.c.y,o.p1.x-o.c.x),b=Math.atan2(o.p2.y-o.c.y,o.p2.x-o.c.x),s=((b-a)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);if(s>Math.PI){[a,b]=[b,a];s=Math.PI*2-s;}b=a+s;
  const p=add(o.c,pt(Math.cos(a)*r,Math.sin(a)*r)),q=add(o.c,pt(Math.cos(b)*r,Math.sin(b)*r));
  line('extension1',o.c,add(o.c,mul(unit(sub(p,o.c)),r+overhang)));line('extension2',o.c,add(o.c,mul(unit(sub(q,o.c)),r+overhang)));
  parts.push({id:'arc',type:'arc',c:o.c,r,a,b});head('arrow1',p,pt(-Math.sin(a),Math.cos(a)));head('arrow2',q,pt(Math.sin(b),-Math.cos(b)));
  const mid=a+s/2,textClearance=numberGap+layoutLabel.length*font*.28*Math.abs(Math.cos(mid))+font*.7*Math.abs(Math.sin(mid));
  drawLabel(add(o.c,pt(Math.cos(mid)*(r+textClearance),Math.sin(mid)*(r+textClearance))));
 }else{
  const extension=(id,p,q,source)=>{
   // A measured projection can lie beyond a finite edge. Extend the actual contour instead.
   if(source){const v=sub(source[1],source[0]),w=sub(q,source[0]),length2=v.x*v.x+v.y*v.y;if(length2>1e-12)p=add(source[0],mul(v,Math.max(0,Math.min(1,(w.x*v.x+w.y*v.y)/length2))));}
   const v=unit(sub(q,p));if(dist(p,q)>.2)line(id,p,add(q,mul(v,overhang)));
  };
  if(o.distanceStyle==='miter'||!o.distanceStyle&&o.miter){
   // 45° 斜线标注：尺寸线与被测方向成 45°，界线垂直于尺寸线，数值仍为真实距离
   const base=dimensionAxis(o)||unit(sub(o.p2,o.p1));
   const rad=(base.x>=0?-1:1)*Math.PI/4,cs=Math.cos(rad),sn=Math.sin(rad);
   const w=pt(base.x*cs-base.y*sn,base.x*sn+base.y*cs);
   const project=q=>{const d=sub(q,o.pos);return add(o.pos,mul(w,d.x*w.x+d.y*w.y));};
   const A=project(o.p1),B=project(o.p2);
   extension('extension1',o.p1,A,o.extensionSources?.[0]);extension('extension2',o.p2,B,o.extensionSources?.[1]);
   const lenMiter=dist(A,B),um=unit(sub(B,A));
   const miterAngle=Math.atan2(um.y,um.x)*180/Math.PI,miterNormal=pt(Math.sin(miterAngle*Math.PI/180),-Math.cos(miterAngle*Math.PI/180));
   if(lenMiter<Math.max(9,layoutLabel.length*font*.6+5)){
    const textReach=layoutLabel.length*font*.35+5,textHalfWidth=layoutLabel.length*font*.3;
    line('line',sub(A,mul(um,4)),add(B,mul(um,textReach+textHalfWidth+1)));
    head('arrow1',A,mul(um,-1));head('arrow2',B,um);labelP=add(add(B,mul(um,textReach)),mul(miterNormal,numberGap));
   }else{line('line',A,B);head('arrow1',A,um);head('arrow2',B,mul(um,-1));labelP=add(mul(add(A,B),.5),mul(miterNormal,numberGap));}
   drawLabel(labelP,miterAngle);
  }
  else{
  let a,b,u,n;
  const axis=dimensionAxis(o);
  if(axis){const project=p=>{const v=sub(p,o.pos);return add(o.pos,mul(axis,v.x*axis.x+v.y*axis.y));};a=project(o.p1);b=project(o.p2);}
  else{u=unit(sub(o.p2,o.p1));n=pt(-u.y,u.x);const off=sub(o.pos,o.p1).x*n.x+sub(o.pos,o.p1).y*n.y;a=add(o.p1,mul(n,off));b=add(o.p2,mul(n,off));}
  const lenAB=dist(a,b);u=unit(sub(b,a));
  extension('extension1',o.p1,a,o.extensionSources?.[0]);extension('extension2',o.p2,b,o.extensionSources?.[1]);
  let angle=Math.atan2(u.y,u.x)*180/Math.PI;if(angle>=90)angle-=180;if(angle< -90)angle+=180;
  const normal=pt(Math.sin(angle*Math.PI/180),-Math.cos(angle*Math.PI/180)),small=lenAB<Math.max(9,layoutLabel.length*font*.6+5),mode=o.distanceStyle||'auto',textWidth=Math.max(6,layoutLabel.length*font*.6+2),along=sub(o.pos,a).x*u.x+sub(o.pos,a).y*u.y,side=along<lenAB/2?-1:1;
  if(mode==='leader'){
   // Keep the measured span and its two arrow tips fixed; route the number on a horizontal shelf.
   const tip=side<0?a:b,reach=leaderLength??Math.max(6,side<0?-along:along-lenAB),elbow=add(add(tip,mul(u,side*reach)),mul(normal,5)),sign=Math.abs(u.x)>.2?Math.sign(u.x)*side:1,shelf=add(elbow,pt(sign*textWidth,0));
   line('line',sub(a,mul(u,4)),add(b,mul(u,4)));head('arrow1',a,mul(u,-1));head('arrow2',b,u);line('leader',tip,elbow);line('shelf',elbow,shelf);drawLabel(add(mul(add(elbow,shelf),.5),pt(0,-numberGap)));
  }else if(mode==='outside'){
   const reach=leaderLength??Math.max(textWidth/2+4,side<0?-along:along-lenAB),tail=reach+textWidth/2+1;
   line('line',sub(a,mul(u,side<0?tail:4)),add(b,mul(u,side>0?tail:4)));head('arrow1',a,mul(u,-1));head('arrow2',b,u);drawLabel(add(add(side<0?a:b,mul(u,side*reach)),mul(normal,numberGap)),angle);
  }else{
  if(small&&mode!=='inside'){
   // Outside numbers sit above the continued dimension line, beyond the arrow.
   // Use the measured label and global font so custom labels/font overrides stay independent.
   const textReach=layoutLabel.length*font*.35+5,textHalfWidth=layoutLabel.length*font*.3;
   line('line',sub(a,mul(u,4)),add(b,mul(u,textReach+textHalfWidth+1)));
   head('arrow1',a,mul(u,-1));head('arrow2',b,u);labelP=add(add(b,mul(u,textReach)),mul(normal,numberGap));
  }
  else{line('line',a,b);head('arrow1',a,u);head('arrow2',b,mul(u,-1));labelP=add(mul(add(a,b),.5),mul(normal,numberGap));}
  if(mode==='horizontal-text')labelP=add(labelP,mul(normal,Math.abs(normal.x)*textWidth/2+Math.abs(normal.y)*font*.3));
  drawLabel(labelP,mode==='horizontal-text'?0:angle);
  }
  }
 }
 const edited=parts.map(p=>p.type==='text'?p:editedPart(p,o.partEdits?.[p.id]));
 if(partsOnly)return edited;if(layout)return {point:labelP,angle:textAngle,font:numberSize};
 const paintOrder=[...edited.filter(p=>!['arrow','text'].includes(p.type)),...edited.filter(p=>p.type==='arrow'),...edited.filter(p=>p.type==='text')];
 const out=paintOrder.map(p=>{if(p.hidden)return '';let svg='';const dash=p.style==='hidden'?'1.2 0.6':p.style==='center'?'3 0.7 0.35 0.7':'',attrs=(dash?`stroke-dasharray="${dash}"`:'')+(p.width?` stroke-width="${p.width}"`:'');
  if(p.type==='line')svg=ln(p.p1,p.p2,attrs);
  else if(p.type==='arrow')svg=arrow(p.p,p.dir,p.size);
  else if(p.type==='arc'){const a=add(p.c,pt(Math.cos(p.a)*p.r,Math.sin(p.a)*p.r)),b=add(p.c,pt(Math.cos(p.b)*p.r,Math.sin(p.b)*p.r));svg=`<path d="M ${a.x} ${a.y} A ${p.r} ${p.r} 0 0 1 ${b.x} ${b.y}" fill="none" ${attrs}/>`;}
  else svg=textAt(p.point,p.label,p.font,p.angle,'data-dim-text="true" style="cursor:move"');
  return `<g data-dim-part="${p.id}">${svg}</g>`;
 }).join('');
 return `<g class="dimension" stroke-width=".25" stroke="currentColor" fill="none">${out}</g>`;
}
function drawingOrder(objects){return [...objects.filter(o=>o.type!=='dim'),...objects.filter(o=>o.type==='dim')];}
function renderShape(o,options={}){
 const pathScale=o.type==='path'?Math.sqrt(Math.abs((o.matrix?.[0]??1)*(o.matrix?.[3]??1)-(o.matrix?.[1]??0)*(o.matrix?.[2]??0)))||1:1;
 const width=((!o.style||o.style==='solid')?.5:.25)/pathScale, dashPattern=o.style==='hidden'?[1.2,.6]:o.style==='center'?[3,.7,.35,.7]:[],dash=dashPattern.map(n=>n/pathScale).join(' ');
 const style=`stroke="currentColor" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round" ${dash?`stroke-dasharray="${dash}"`:''}`;let s='';
 if(o.type==='line')s=ln(o.p1,o.p2,style);
 if(o.type==='rect')s=`<rect x="${Math.min(o.p1.x,o.p2.x)}" y="${Math.min(o.p1.y,o.p2.y)}" width="${Math.abs(o.p2.x-o.p1.x)}" height="${Math.abs(o.p2.y-o.p1.y)}" ${style}/>`;
 if(o.type==='circle')s=`<circle cx="${o.c.x}" cy="${o.c.y}" r="${o.r}" ${style}/>`;
 if(o.type==='arc'){const a=arcGeometry(o);s=a?`<path d="${a.d}" ${style}/>`:'';}
 if(o.type==='profile')s=`<path d="${profileGeometry(o).d}" ${style}/>`;
 if(o.type==='poly')s=`<${o.closed?'polygon':'polyline'} points="${o.points.map(p=>`${p.x},${p.y}`).join(' ')}" ${style}/>`;
 if(o.type==='path')s=`<path d="${esc(pathD(o))}" transform="matrix(${(o.matrix||[1,0,0,1,0,0]).join(' ')})" ${style}/>`;
 if(o.type==='text')s=`<text x="${o.p.x}" y="${o.p.y}" ${o.textAngle?`transform="rotate(${o.textAngle} ${o.p.x} ${o.p.y})"`:''} font-family="Arial, Microsoft YaHei, sans-serif" font-size="${o.size||3.5}" fill="currentColor" text-anchor="${o.align||'start'}">${esc(o.text)}</text>`;
 if(o.type==='dim')s=dimension(o,options);
 return s;
}
function stepGeometry(params={}){
 const defaults={L:70,W:40,H:45,sl:28,sh:20},values={};
 for(const [key,value] of Object.entries(defaults)){values[key]=params[key]===undefined?value:Number(params[key]);if(!Number.isFinite(values[key])||values[key]<=0||values[key]>10000)throw Error('阶梯构件尺寸必须为有效的正数');}
 const {L,W,H,sl,sh}=values;if(sl>=L||sh>=H)throw Error('高台长度需小于总长，低台高度需小于总高');
 const profile=[[0,0],[L,0],[L,sh],[sl,sh],[sl,H],[0,H]],vertices=[0,W].flatMap(y=>profile.map(([x,z])=>[x,y,z])),faces=[[0,1,2,3,4,5],[11,10,9,8,7,6],...profile.map((_,i)=>[i,i+6,(i+1)%6+6,(i+1)%6])];
 return {params:values,profile,vertices,faces};
}
function stepPreview(params={}){
 const model=stepGeometry(params),points=model.vertices.map(([x,y,z])=>pt((x+y)*Math.sqrt(3)/2,(x-y)/2-z)),xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,height=Math.max(...ys)-minY,k=Math.min(110/width,80/height),project=p=>pt(65+(p.x-minX-width/2)*k,48+(p.y-minY-height/2)*k),positions=points.map(project),visible=[3,4,5,6,0],edges=new Map();
 const faces=visible.map(index=>{const ids=model.faces[index];for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length],key=[a,b].sort((a,b)=>a-b).join(',');edges.set(key,[a,b]);}return `<polygon data-face="${index}" points="${ids.map(i=>fmt(positions[i].x)+','+fmt(positions[i].y)).join(' ')}" fill="${index===0?'#edf3f8':[4,6].includes(index)?'#fafcff':'#dce6ef'}" stroke="none"/>`;}).join('');
 return `<g class="step-model">${faces}<path d="${[...edges.values()].map(([a,b])=>`M${fmt(positions[a].x)} ${fmt(positions[a].y)}L${fmt(positions[b].x)} ${fmt(positions[b].y)}`).join(' ')}" fill="none"/></g>`;
}
function makePreset(kind='step',params={}){
 const L=Number(params.L)||70,W=Number(params.W)||40,H=Number(params.H)||45,sl=Number(params.sl)||28,sh=Number(params.sh)||20,R=Number(params.R)||8,T=Number(params.T)||12;
 const objs=[],x=78,y=46,tx=x,ty=y+H+35,lx=189,ly=y;
 const push=(type,data,layer='front',style='solid')=>{const o=shape(type,data,layer,style);objs.push(o);return o;};
 const line=(a,b,layer,style)=>push('line',{p1:a,p2:b},layer,style),rect=(a,b,layer)=>push('rect',{p1:a,p2:b},layer);
 const dim=(kind,a,b,pos,role='given',layer='front')=>push('dim',{kind,p1:a,p2:b,pos,role,override:'',sourceLayer:layer},'dims');
 let front;
 if(kind==='step'){
  const model=stepGeometry({L,W,H,sl,sh});front=push('poly',{points:model.profile.map(([u,z])=>pt(x+u,y+H-z)),closed:true});
  rect(pt(tx,ty),pt(tx+L,ty+W),'top');line(pt(tx+sl,ty),pt(tx+sl,ty+W),'top');
  rect(pt(lx,ly),pt(lx+W,ly+H),'left');line(pt(lx,ly+H-sh),pt(lx+W,ly+H-sh),'left','hidden');
  const a=anchors(front);const d=dim('horizontal',a[5],a[4],pt(x,y-6),'answer');d.ref1={id:front.id,index:5};d.ref2={id:front.id,index:4};
  dim('vertical',pt(x+L,y+H-sh),pt(x+L,y+H),pt(x+L+6,y),'answer');
 }else if(kind==='slot'){
  front=push('poly',{points:[pt(x,y),pt(x+T,y),pt(x+T,y+H-T),pt(x+L-T,y+H-T),pt(x+L-T,y),pt(x+L,y),pt(x+L,y+H),pt(x,y+H)],closed:true});
  rect(pt(tx,ty),pt(tx+L,ty+W),'top');line(pt(tx+T,ty),pt(tx+T,ty+W),'top');line(pt(tx+L-T,ty),pt(tx+L-T,ty+W),'top');
  rect(pt(lx,ly),pt(lx+W,ly+H),'left');line(pt(lx,ly+H-T),pt(lx+W,ly+H-T),'left','hidden');
  dim('horizontal',pt(x,y),pt(x+T,y),pt(x,y-6),'answer');dim('vertical',pt(x+L-T,y+H-T),pt(x+L-T,y+H),pt(x+L+6,y),'answer');
 }else{
  front=rect(pt(x,y),pt(x+L,y+H));const c=pt(x+L/2,y+H/2),circle=push('circle',{c,r:R});
  line(pt(c.x-R-4,c.y),pt(c.x+R+4,c.y),'front','center');line(pt(c.x,c.y-R-4),pt(c.x,c.y+R+4),'front','center');
  rect(pt(tx,ty),pt(tx+L,ty+W),'top');[-R,R].forEach(v=>line(pt(tx+L/2+v,ty),pt(tx+L/2+v,ty+W),'top','hidden'));line(pt(tx+L/2,ty-3),pt(tx+L/2,ty+W+3),'top','center');
  rect(pt(lx,ly),pt(lx+W,ly+H),'left');[-R,R].forEach(v=>line(pt(lx,ly+H/2+v),pt(lx+W,ly+H/2+v),'left','hidden'));line(pt(lx-3,ly+H/2),pt(lx+W+3,ly+H/2),'left','center');
  push('dim',{kind:'diameter',diameterStyle:'leader',c:{...c},r:R,pos:pt(x+L+10,y+5),role:'answer',circleId:circle.id,sourceLayer:'front',override:''},'dims');
  dim('horizontal',pt(x,y+H),pt(c.x,c.y),pt(x,y+H+6),'answer');dim('vertical',pt(x,y+H),c,pt(x-6,y),'given');
 }
 dim('horizontal',pt(x,y+H),pt(x+L,y+H),pt(x,y+H+(kind==='hole'?12:6)));dim('vertical',pt(x,y),pt(x,y+H),pt(x-(kind==='hole'?12:6),y));dim('vertical',pt(tx,ty),pt(tx,ty+W),pt(tx-6,ty),'given','top');
 for(const d of objs.filter(o=>o.type==='dim'&&o.p1&&o.p2))for(const k of [1,2]){
  if(d['ref'+k])continue;for(const o of objs.filter(o=>o.type!=='dim'&&o.layer===d.sourceLayer)){
   const index=anchors(o).findIndex(a=>dist(a,d['p'+k])<.001);if(index>=0){d['ref'+k]={id:o.id,index};break;}
  }
 }
 return objs;
}
const dimensionLayout=(o,options={})=>dimension(o,{...options,layout:true});
const dimensionParts=(o,options={})=>dimension(o,{...options,partsOnly:true});
function viewMembers(objects,view){const ids=new Set(objects.filter(o=>o.layer===view).map(o=>o.id)),names={front:'主视图',top:'俯视图',left:'左视图'};return objects.filter(o=>o.layer===view||o.sourceLayer===view||(o.type==='text'&&o.layer==='notes'&&o.text===names[view])||(o.type==='dim'&&!o.sourceLayer&&(ids.has(o.ref1?.id)||ids.has(o.ref2?.id)||ids.has(o.circleId))));}
function viewOf(o){if(['front','top','left'].includes(o.layer))return o.layer;if(['front','top','left'].includes(o.sourceLayer))return o.sourceLayer;return {主视图:'front',俯视图:'top',左视图:'left'}[o.text]||null;}
const api={NS,clone,pt,add,sub,mul,len,dist,unit,round,fmt,esc,id,shape,anchors,transform,inverse,parsePath,pathD,pathAnchors,move,matrixMultiply,scaleObject,updateLinked,translateGroup,isViewLabel,withoutViewLabels,prepareDrawing,withCornerMembers,withAttachedDimensions,withViewGroups,referencePoint,measurementRefs,intersectionSpecs,intersectionRefs,resolveIntersection,projectToLine,filletBetween,projectToSegment,measurePointLine,measureLines,measureAngleLines,resolveMeasurement,segments,geometryParts,circularParts,geometryPart,circlePart,closestCurvePoint,explodeShape,intersect,arcThrough,arcGeometry,arcFromCenter,arcAngle,profileGeometry,snapGrid,normalizeSnaps,snapMove,snap,driveDimension,dimValue,dimLabel,dimension,dimensionLayout,dimensionParts,viewMembers,viewOf,drawingOrder,renderShape,stepGeometry,stepPreview,makePreset};
root.Draft=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
