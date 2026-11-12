/* Local mesh import and orthographic hidden-line projection. No external resources. */
(function(root){
'use strict';
const MAX_FACES=30000,MAX_BYTES=20*1024*1024;
const add=(a,b)=>a.map((n,i)=>n+b[i]),sub=(a,b)=>a.map((n,i)=>n-b[i]),mul=(a,k)=>a.map(n=>n*k);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a),unit=a=>mul(a,1/(norm(a)||1)),mix=(a,b,t)=>add(a,mul(sub(b,a),t));
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e12;
function bounds(vertices){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of vertices)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max,size:sub(max,min)};}
function bytes(data){if(data instanceof ArrayBuffer)return new Uint8Array(data);if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);return new TextEncoder().encode(String(data));}
function triangulate(face,vertices){
 if(face.length===3)return [face];
 // Ear clipping preserves concave planar OBJ faces, unlike fan triangulation.
 let n=[0,0,0];for(let i=0;i<face.length;i++)n=add(n,cross(vertices[face[i]],vertices[face[(i+1)%face.length]]));
 const drop=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),axes=[0,1,2].filter(i=>i!==drop),p=face.map(i=>axes.map(k=>vertices[i][k]));
 const area=p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0),sign=area<0?-1:1;
 if(Math.abs(area)<1e-18)throw Error('OBJ 包含退化多边形');
 const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),remaining=face.map((_,i)=>i),out=[];
 while(remaining.length>3){let found=false;for(let i=0;i<remaining.length;i++){
  const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];
  if(turn(p[a],p[b],p[c])*sign<=1e-16)continue;
  if(remaining.some(q=>q!==a&&q!==b&&q!==c&&turn(p[a],p[b],p[q])*sign>=-1e-14&&turn(p[b],p[c],p[q])*sign>=-1e-14&&turn(p[c],p[a],p[q])*sign>=-1e-14))continue;
  out.push([face[a],face[b],face[c]]);remaining.splice(i,1);found=true;break;
 }if(!found)throw Error('OBJ 多边形自交或非平面，请先在建模软件中三角化');}
 out.push(remaining.map(i=>face[i]));return out;
}
function parseObj(text){
 const vertices=[],faces=[];for(const raw of text.split(/\r?\n/)){const parts=raw.split('#')[0].trim().split(/\s+/),kind=parts.shift();
  if(kind==='v'){const p=parts.slice(0,3).map(Number);if(p.length!==3||!p.every(finite))throw Error('OBJ 顶点坐标无效');vertices.push(p);if(vertices.length>150000)throw Error('模型顶点过多，请简化后导入');}
  if(kind==='f'){if(parts.length<3||parts.length>1000)throw Error('OBJ 面顶点数量无效');const face=parts.map(p=>{const n=Number(p.split('/')[0]),i=n<0?vertices.length+n:n-1;if(!Number.isInteger(n)||!n||i<0||i>=vertices.length)throw Error('OBJ 面引用了无效顶点');return i;});faces.push(...triangulate(face,vertices));if(faces.length>MAX_FACES)throw Error('模型超过 30,000 个三角面，请简化后导入');}
 }return {vertices,faces};
}
function parseStl(data){
 const input=bytes(data),vertices=[],faces=[],view=new DataView(input.buffer,input.byteOffset,input.byteLength),count=input.length>=84?view.getUint32(80,true):0;
 if(count>0&&84+count*50<=input.length){if(count>MAX_FACES)throw Error('模型超过 30,000 个三角面，请简化后导入');for(let i=0;i<count;i++){const face=[];for(let k=0;k<3;k++){const at=84+i*50+12+k*12,p=[0,4,8].map(j=>view.getFloat32(at+j,true));if(!p.every(finite))throw Error('STL 顶点坐标无效');face.push(vertices.length);vertices.push(p);}faces.push(face);}}
 else{const text=new TextDecoder().decode(input),facets=[...text.matchAll(/facet\s+normal\s+[^\r\n]+\s+outer\s+loop\s+([\s\S]*?)\s+endloop\s+endfacet/gi)];
  if(!/^\s*solid\b/i.test(text)||!facets.length)throw Error('STL 文件不完整或格式无效');
  if(facets.length>MAX_FACES)throw Error('模型超过 30,000 个三角面，请简化后导入');
  for(const facet of facets){const points=[...facet[1].matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)];if(points.length!==3)throw Error('STL 三角面不完整');const face=[];for(const point of points){const p=point.slice(1).map(Number);if(!p.every(finite))throw Error('STL 顶点坐标无效');face.push(vertices.length);vertices.push(p);}faces.push(face);}
 }return {vertices,faces};
}
function prepare(raw){
 if(!raw.faces.length||!raw.vertices.length)throw Error('模型没有可投影的三角面，请导出实体表面网格');
 const box=bounds(raw.vertices),diagonal=norm(box.size);if(diagonal<1e-9)throw Error('模型尺寸为零');
 const center=mul(add(box.min,box.max),.5),tolerance=diagonal*1e-8,vertices=[],map=new Map(),remap=raw.vertices.map(v=>{const p=sub(v,center),key=p.map(x=>Math.round(x/tolerance)).join(',');if(!map.has(key)){map.set(key,vertices.length);vertices.push(p);}return map.get(key);});
 const triangles=[],seen=new Set(),edges=new Map();let removed=0;
 for(const face of raw.faces){const ids=face.map(i=>remap[i]),[a,b,c]=ids.map(i=>vertices[i]),normal=cross(sub(b,a),sub(c,a)),key=ids.slice().sort((a,b)=>a-b).join(',');if(norm(normal)<diagonal*diagonal*1e-13||seen.has(key)){removed++;continue;}seen.add(key);
  const ti=triangles.length;triangles.push({ids,normal:unit(normal)});for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],key=Math.min(a,b)+','+Math.max(a,b);if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(ti);}
 }
 if(!triangles.length)throw Error('模型只含退化三角面');
 const edgeList=[...edges.values()],open=edgeList.filter(e=>e.faces.length!==2).length;
 return {vertices,triangles,edges:edgeList,box:bounds(vertices),warnings:[...(open?['模型含开放边或非流形边，遮挡关系请人工核对']:[]),...(removed?[`已略过 ${removed} 个退化或重复面`]:[])]};
}
function parse(data,name='model.stl'){
 const input=bytes(data);if(input.byteLength>MAX_BYTES)throw Error('3D 模型请控制在 20 MB 以内');
 const ext=name.split('.').pop().toLowerCase();if(!['stl','obj'].includes(ext))throw Error('目前支持 STL、OBJ 模型；STEP / STP 请先导出为 STL');
 const model=prepare(ext==='obj'?parseObj(new TextDecoder().decode(input)):parseStl(input));model.name=String(name).slice(0,200);model.format=ext.toUpperCase();return model;
}
const axis=s=>{const p=[0,0,0];p['xyz'.indexOf(s.at(-1))]=s.startsWith('-')?-1:1;return p;};
function orient(model,options={}){
 const up=options.up==='y'?'y':'z',front=String(options.front||(up==='z'?'-y':'z'));
 if(!['x','-x','y','-y','z','-z'].includes(front)||front.at(-1)===up)throw Error('正面观察方向不能与向上轴平行');
 const U=axis(up),N=axis(front),R=cross(U,N),F=mul(N,-1),units=Number(options.units??1);
 if(!Number.isFinite(units)||units<=0||units>1000000)throw Error('模型单位换算无效');
 const vertices=model.vertices.map(p=>[dot(p,R)*units,dot(p,F)*units,dot(p,U)*units]);return {vertices,triangles:model.triangles.map(t=>({...t,normal:[dot(t.normal,R),dot(t.normal,F),dot(t.normal,U)]})),edges:model.edges,box:bounds(vertices)};
}
const cameras={front:{right:[1,0,0],down:[0,0,-1],eye:[0,-1,0]},top:{right:[1,0,0],down:[0,1,0],eye:[0,0,1]},side:{right:[0,1,0],down:[0,0,-1],eye:[-1,0,0]},iso:{right:unit([1,1,0]),down:unit([1,-1,-2]),eye:unit([1,-1,1])}};
function projected(model,kind){const c=cameras[kind];return model.vertices.map(p=>[dot(p,c.right),dot(p,c.down),dot(p,c.eye)]);}
const cross2=(a,b)=>a[0]*b[1]-a[1]*b[0];
function projection(model,kind,hidden=true){
 const vertices=projected(model,kind),camera=cameras[kind],box=bounds(vertices),diagonal=norm(model.box.size),eps=diagonal*1e-7,projectedFaces=[];
 for(const triangle of model.triangles){const points=triangle.ids.map(i=>vertices[i]),[a,b,c]=points,ab=sub(b,a),ac=sub(c,a),area=cross2(ab,ac);if(Math.abs(area)<diagonal*diagonal*1e-14)continue;
  const bary=p=>{const v=sub(p,a),b=cross2(v,ac)/area,c=cross2(ab,v)/area;return [1-b-c,b,c];};
  projectedFaces.push({points,bary,minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))});
 }
 const resolution=Math.min(80,Math.max(4,Math.ceil(Math.sqrt(projectedFaces.length/2)))),width=box.size[0]||1,height=box.size[1]||1,cells=new Map(),cellX=x=>Math.min(resolution-1,Math.max(0,Math.floor((x-box.min[0])/width*resolution))),cellY=y=>Math.min(resolution-1,Math.max(0,Math.floor((y-box.min[1])/height*resolution)));
 const visit=(x1,y1,x2,y2,fn)=>{for(let x=cellX(x1);x<=cellX(x2);x++)for(let y=cellY(y1);y<=cellY(y2);y++)fn(x+resolution*y);};
 let cellReferences=0,comparisons=0;
 for(let i=0;i<projectedFaces.length;i++){const t=projectedFaces[i];visit(t.minX,t.minY,t.maxX,t.maxY,key=>{if(++cellReferences>2000000)throw Error('模型投影重叠过多，请简化模型后导入');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);});}
 const out=[],crease=Math.cos(25*Math.PI/180);
 for(const edge of model.edges){const normals=edge.faces.map(i=>model.triangles[i].normal),facing=normals.map(n=>dot(n,camera.eye));
  if(normals.length===2&&Math.abs(dot(normals[0],normals[1]))>crease&&!(facing[0]*facing[1]<-1e-12||(Math.abs(facing[0])<1e-10)!==(Math.abs(facing[1])<1e-10)))continue;
  const a=vertices[edge.a],b=vertices[edge.b];if(Math.hypot(a[0]-b[0],a[1]-b[1])<eps)continue;
  const candidates=new Set();visit(Math.min(a[0],b[0])-eps,Math.min(a[1],b[1])-eps,Math.max(a[0],b[0])+eps,Math.max(a[1],b[1])+eps,key=>{for(const i of cells.get(key)||[])candidates.add(i);});
  const intervals=[];for(const i of candidates){if(++comparisons>5000000)throw Error('模型遮挡关系过于复杂，请简化模型后导入');const t=projectedFaces[i];if(t.maxX<Math.min(a[0],b[0])-eps||t.minX>Math.max(a[0],b[0])+eps||t.maxY<Math.min(a[1],b[1])-eps||t.minY>Math.max(a[1],b[1])+eps)continue;
   const ba=t.bary(a),bb=t.bary(b);let lo=0,hi=1;
   const clip=(value,slope,min)=>{if(Math.abs(slope)<1e-14){if(value<min)lo=2;}else if(slope>0)lo=Math.max(lo,(min-value)/slope);else hi=Math.min(hi,(min-value)/slope);};
   for(let j=0;j<3;j++)clip(ba[j],bb[j]-ba[j],-1e-9);
   const da=dot(ba,t.points.map(p=>p[2]))-a[2],db=dot(bb,t.points.map(p=>p[2]))-b[2];clip(da,db-da,eps);
   if(hi-lo>1e-8&&lo<=1&&hi>=0)intervals.push([Math.max(0,lo),Math.min(1,hi)]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);const covered=[];for(const item of intervals){const last=covered.at(-1);if(last&&item[0]<=last[1]+1e-8)last[1]=Math.max(last[1],item[1]);else covered.push(item.slice());}
  let at=0;const emit=(lo,hi,isHidden)=>{if(hi-lo<1e-7||isHidden&&(!hidden||kind==='iso'))return;out.push({a:mix(a,b,lo).slice(0,2),b:mix(a,b,hi).slice(0,2),hidden:isHidden});};
  for(const [lo,hi] of covered){emit(at,lo,false);emit(lo,hi,true);at=hi;}emit(at,1,false);
 }
 return {kind,edges:mergeEdges(out,eps),width:box.size[0],height:box.size[1],min:box.min.slice(0,2)};
}
function mergeEdges(edges,tolerance){
 // Combine coincident projections; visible edges take precedence over hidden ones.
 const groups=new Map();for(const edge of edges){const delta=sub(edge.b,edge.a),length=norm(delta);if(length<tolerance)continue;let u=mul(delta,1/length);if(u[0]<-1e-7||Math.abs(u[0])<1e-7&&u[1]<0)u=mul(u,-1);
  const d=cross2(u,edge.a),key=u.map(x=>Math.round(x*1e6)).join(',')+','+Math.round(d/tolerance),a=dot(edge.a,u),b=dot(edge.b,u);
  if(!groups.has(key))groups.set(key,{u,d,items:[]});groups.get(key).items.push({lo:Math.min(a,b),hi:Math.max(a,b),hidden:edge.hidden});
 }
 const out=[];for(const {u,d,items} of groups.values()){const events=[];for(const item of items){events.push({at:item.lo,delta:1,hidden:item.hidden},{at:item.hi,delta:-1,hidden:item.hidden});}events.sort((a,b)=>a.at-b.at);let visible=0,hidden=0,previous=null;
  const point=t=>[u[0]*t-u[1]*d,u[1]*t+u[0]*d];let last=null;
  for(const event of events){if(previous!=null&&event.at-previous>tolerance&&(visible||hidden)){const isHidden=!visible;if(last&&last.hidden===isHidden&&norm(sub(last.b,point(previous)))<tolerance*2)last.b=point(event.at);else{last={a:point(previous),b:point(event.at),hidden:isHidden};out.push(last);}}if(event.hidden)hidden+=event.delta;else visible+=event.delta;previous=event.at;}
 }return out;
}
function recoverCurves(edges,tolerance){
 const vertices=new Map(),links=new Map(),key=p=>p.map(x=>Math.round(x/tolerance)).join(','),used=new Set(),curves=[];
 edges.forEach((e,i)=>{for(const p of [e.a,e.b]){const k=key(p);vertices.set(k,p);if(!links.has(k))links.set(k,[]);links.get(k).push(i);}});
 for(let i=0;i<edges.length;i++){if(used.has(i))continue;const seed=edges[i],component=[],points=[seed.a],local=new Set();let at=key(seed.a),current=i,closed=false;
  while(!local.has(current)){local.add(current);component.push(current);const edge=edges[current],next=key(edge.a)===at?edge.b:edge.a;points.push(next);at=key(next);if(at===key(points[0])){closed=true;break;}const choices=(links.get(at)||[]).filter(j=>!local.has(j)&&edges[j].hidden===seed.hidden);if(links.get(at)?.length!==2||choices.length!==1)break;current=choices[0];}
  if(points.length<8||(!closed&&(links.get(key(points[0]))?.length!==1)))continue;
  const a=points[0],b=points[Math.floor((points.length-1)/3)],c=points[Math.floor(2*(points.length-1)/3)],u=sub(b,a),v=sub(c,a),den=2*cross2(u,v);if(Math.abs(den)<tolerance*tolerance)continue;
  const center=add(a,[(dot(u,u)*v[1]-dot(v,v)*u[1])/den,(dot(v,v)*u[0]-dot(u,u)*v[0])/den]),r=norm(sub(a,center));
  if(r<tolerance||points.some(p=>Math.abs(norm(sub(p,center))-r)>Math.max(tolerance*5,r*1e-5)))continue;
  let sweep=0,valid=true;for(let j=1;j<points.length;j++){const a=sub(points[j-1],center),b=sub(points[j],center),angle=Math.atan2(cross2(a,b),dot(a,b));if(Math.abs(angle)>Math.PI/5||sweep&&angle*sweep<0){valid=false;break;}sweep+=angle;}if(!valid)continue;
  component.forEach(i=>used.add(i));curves.push({type:closed?'circle':'arc',c:{x:center[0],y:center[1]},r,startAngle:Math.atan2(points[0][1]-center[1],points[0][0]-center[0])*180/Math.PI,sweepAngle:sweep*180/Math.PI,hidden:seed.hidden});
 }return {curves,edges:edges.filter((_,i)=>!used.has(i))};
}
function generate(model,options={}){
 const oriented=orient(model,options),views=Object.keys(cameras).map(kind=>projection(oriented,kind,options.hidden!==false)),[L,W,H]=oriented.box.size,[front,top,side,iso]=views,gap=18;
 const fit=Math.min(1,(257-gap)/(L+Math.max(W,iso.width)),(170-gap)/(H+Math.max(W,iso.height))),scales=[1,.5,.25,.2,.1,.05,.02,.01,.005,.002,.001,.0005,.0002,.0001];
 const scale=options.scale&&options.scale!=='auto'?Number(options.scale):scales.find(s=>s<=fit+1e-12);if(!scale||!Number.isFinite(scale)||scale<=0||scale>fit+1e-9)throw Error('当前比例放不进 A4 图纸，请选择自动适应或更小比例');
 const totalW=(L+Math.max(W,iso.width))*scale+gap,totalH=(H+Math.max(W,iso.height))*scale+gap,x=(297-totalW)/2,y=(210-totalH)/2;
 const offsets={front:[x,y],top:[x,y+H*scale+gap],side:[x+L*scale+gap,y],iso:[x+L*scale+gap,y+H*scale+gap]};
 let count=0;for(const view of views){view.offset=offsets[view.kind];const recovered=recoverCurves(view.edges,Math.max(1e-9,norm(oriented.box.size)*2e-7));view.curves=recovered.curves;view.edges=recovered.edges;count+=view.edges.length+view.curves.length;}
 if(count>12000||views.some(v=>v.edges.length>9000))throw Error('投影线段过多，请简化模型后再导入');
 return {views,scale,size:[L,W,H],name:model.name,format:model.format,warnings:model.warnings.slice()};
}
function drawing(result,idFactory){
 let index=0;const id=idFactory||(()=>`model-${index++}`),batch=id(),objects=[],groups=[];
 for(const view of result.views){const group=batch+':'+view.kind,ids=[],point=p=>({x:view.offset[0]+(p[0]-view.min[0])*result.scale,y:view.offset[1]+(p[1]-view.min[1])*result.scale});
  for(const hidden of [false,true]){const edges=view.edges.filter(e=>e.hidden===hidden);if(!edges.length)continue;const segments=edges.flatMap(e=>{const a=point(e.a),b=point(e.b);return [{cmd:'M',v:[a.x,a.y]},{cmd:'L',v:[b.x,b.y]}];});const object={id:id(),type:'path',layer:'drawing',style:hidden?'hidden':'solid',matrix:[1,0,0,1,0,0],segments,viewGroup:group,projectionRole:view.kind};objects.push(object);ids.push(object.id);}
  for(const curve of view.curves){const object={id:id(),type:curve.type,layer:'drawing',style:curve.hidden?'hidden':'solid',c:point([curve.c.x,curve.c.y]),r:curve.r*result.scale,viewGroup:group,projectionRole:view.kind};if(curve.type==='arc'){object.startAngle=curve.startAngle;object.sweepAngle=curve.sweepAngle;}objects.push(object);ids.push(object.id);}
  groups.push({id:group,role:view.kind,ids});
 }return {objects,groups};
}
const api={parse,generate,drawing,orient,projection};root.ModelViews=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
