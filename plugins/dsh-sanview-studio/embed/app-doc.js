/* Project document handling: the default drawing, validation on load, and writing a .sanview file. */
(function(root){
'use strict';
const D=typeof module!=='undefined'&&module.exports?require('./engine.js'):root.Draft;
const I=typeof module!=='undefined'&&module.exports?require('./inspection.js'):root.DimensionInspection;
const N=root.AppNames;
const {kindNames,partNames,typeNames,profileNames,diameterStyles,radiusStyles,distanceStyles}=N;
const {pt,round,clone}=D;
function fresh(){return {version:2,title:'阶梯形构件的尺寸标注',font:3.5,scale:1,grid:true,gridStep:2.5,showDimensions:true,crosshair:true,snaps:D.normalizeSnaps(),inspection:I.validateOptions(null,[]),objects:D.prepareDrawing(D.makePreset('step'))};}
function normalizeProject(objects){
 // 工程是自己画出来的，重新打开时不该丢掉线宽或视图名，只整理图层与线型
 return objects.map(source=>{const o=clone(source);o.layer=o.type==='dim'?'dims':'drawing';if(['rect','poly','circle','arc','profile'].includes(o.type)&&o.style==='center')o.style='solid';delete o.sourceLayer;return o;});
}
function validateDoc(raw){
 if(!raw||![1,2].includes(raw.version)||!Array.isArray(raw.objects)||raw.objects.length>4000)throw Error('工程格式不受支持');
 const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e7;
 const p=v=>{if(!v||!finite(v.x)||!finite(v.y))throw Error('工程坐标无效');return pt(v.x,v.y);};
 const out=fresh();for(const key of ['title'])if(typeof raw[key]==='string')out[key]=raw[key].slice(0,key==='title'?100:300);
 if(finite(raw.scale)&&raw.scale>=.0001&&raw.scale<=100)out.scale=raw.scale;if(finite(raw.font)&&raw.font>=.5&&raw.font<=20)out.font=raw.font;if(finite(raw.gridStep)&&raw.gridStep>=.1&&raw.gridStep<=50)out.gridStep=round(raw.gridStep,2);
 for(const key of ['grid','crosshair'])if(typeof raw[key]==='boolean')out[key]=raw[key];out.snaps=D.normalizeSnaps(raw.snaps);out.showDimensions=typeof raw.showDimensions==='boolean'?raw.showDimensions:raw.layers?.dims!==false;
 const ids=new Set();out.objects=raw.objects.map(v=>{if(!Object.keys(typeNames).includes(v.type)||typeof v.id!=='string'||v.id.length>100||ids.has(v.id))throw Error('工程图形无效');ids.add(v.id);const o={id:v.id,type:v.type,layer:v.type==='dim'?'dims':'drawing',style:['solid','thin','hidden','center'].includes(v.style)?v.style:'solid'};
 if(['line','rect','profile'].includes(v.type)){o.p1=p(v.p1);o.p2=p(v.p2);}
 if(v.type==='profile'){if(!Object.keys(profileNames).filter(k=>k!=='rect').includes(v.profile))throw Error('形体类型无效');o.profile=v.profile;o.radius=finite(v.radius)&&v.radius>0?v.radius:5;}
 if(v.type==='arc'){if(v.c&&finite(v.startAngle)&&finite(v.sweepAngle)&&finite(v.r)&&v.r>0){o.c=p(v.c);o.r=v.r;o.startAngle=v.startAngle;o.sweepAngle=v.sweepAngle;if(!D.arcGeometry(o))throw Error('圆弧角度无效');}else{o.p1=p(v.p1);o.p2=p(v.p2);o.p3=p(v.p3);if(!D.arcThrough(o.p1,o.p2,o.p3))throw Error('圆弧的三个点无效');}}
 if(v.type==='circle'){o.c=p(v.c);if(!finite(v.r)||v.r<=0)throw Error('圆半径无效');o.r=v.r;}
 if(v.type==='poly'){if(!Array.isArray(v.points)||v.points.length<2||v.points.length>20000)throw Error('折线无效');o.points=v.points.map(p);o.closed=!!v.closed;}
 if(v.type==='path'){if(!Array.isArray(v.segments)||v.segments.length>20000)throw Error('路径无效');const counts={M:2,L:2,C:6,S:4,Q:4,T:2,A:7,Z:0};o.segments=v.segments.map(s=>{if(counts[s.cmd]===undefined||!Array.isArray(s.v)||s.v.length!==counts[s.cmd]||!s.v.every(finite))throw Error('路径参数无效');return {cmd:s.cmd,v:[...s.v]};});o.matrix=Array.isArray(v.matrix)&&v.matrix.length===6&&v.matrix.every(finite)?[...v.matrix]:[1,0,0,1,0,0];}
 if(v.type==='text'){o.p=p(v.p);o.text=String(v.text??'').slice(0,200);o.size=finite(v.size)&&v.size>0?Math.min(v.size,30):3.5;o.align=['start','middle','end'].includes(v.align)?v.align:'start';}
 if(v.type==='dim'){if(!Object.keys(kindNames).includes(v.kind))throw Error('尺寸类型无效');o.kind=v.kind;o.pos=p(v.pos);o.role=v.role==='answer'?'answer':'given';o.override=String(v.override??'').slice(0,40);if(['radius','diameter','arcLength','chordLength'].includes(v.kind)){o.c=p(v.c);if(!finite(v.r)||v.r<=0)throw Error('尺寸半径无效');o.r=v.r;if(typeof v.circleId==='string')o.circleId=v.circleId;if(Number.isInteger(v.circlePart)&&v.circlePart>=0&&v.circlePart<=80000)o.circlePart=v.circlePart;if(['arcLength','chordLength'].includes(v.kind)){if(!finite(v.arcStart)||!finite(v.arcSweep)||Math.abs(v.arcSweep)<1e-7)throw Error('弧长 / 弦长尺寸需要有效的圆弧起止角');o.arcStart=v.arcStart;o.arcSweep=v.arcSweep;}}else{o.p1=p(v.p1);o.p2=p(v.p2);if(v.kind==='angle')o.c=p(v.c);for(const key of ['ref1','ref2'])if(v[key]&&typeof v[key].id==='string'&&Number.isInteger(v[key].index)&&v[key].index>=0)o[key]={id:v[key].id,index:v[key].index};}}
 if(v.type==='dim'){if(v.textOffset)o.textOffset=p(v.textOffset);if(finite(v.textAngle))o.textAngle=v.textAngle;if(finite(v.axisAngle))o.axisAngle=v.axisAngle;if(finite(v.textSize)&&v.textSize>=.5&&v.textSize<=20)o.textSize=v.textSize;if(v.circleOffset)o.circleOffset=p(v.circleOffset);for(const key of ['ref1','ref2'])if(o[key]&&v[key]?.offset)o[key].offset=p(v[key].offset);}
 if(v.type==='dim'){o.extension=finite(v.extension)&&Math.abs(v.extension)<=50?v.extension:v.kind==='angle'?2:['radius','diameter','arcLength','chordLength'].includes(v.kind)?2:2.5;for(const key of ['autoSymbols','hideText','reference','spherical'])if(typeof v[key]==='boolean')o[key]=v[key];if(['radial','perpendicular'].includes(v.arcLeader))o.arcLeader=v.arcLeader;if(typeof v.miter==='boolean')o.miter=v.miter;if(distanceStyles[v.distanceStyle])o.distanceStyle=v.distanceStyle;if(finite(v.leaderLength)&&v.leaderLength>=0&&v.leaderLength<=100)o.leaderLength=round(v.leaderLength,2);if(v.kind==='diameter'&&(diameterStyles[v.diameterStyle]||v.diameterStyle==='legacy'))o.diameterStyle=v.diameterStyle;if(v.kind==='radius'&&(radiusStyles[v.radiusStyle]||v.radiusStyle==='legacy'))o.radiusStyle=v.radiusStyle;if(typeof v.suffix==='string')o.suffix=v.suffix.slice(0,20);}
 if(v.type==='dim'&&v.partEdits&&typeof v.partEdits==='object'){o.partEdits={};for(const key of Object.keys(partNames).filter(k=>k!=='number')){const edit=v.partEdits[key];if(!edit||typeof edit!=='object')continue;const out={};for(const pos of ['offset','start','end'])if(edit[pos])out[pos]=p(edit[pos]);if(finite(edit.width)&&edit.width>=.05&&edit.width<=2)out.width=edit.width;if(finite(edit.angle))out.angle=edit.angle;if(finite(edit.scale)&&edit.scale>=.05&&edit.scale<=20)out.scale=edit.scale;if(['thin','hidden','center'].includes(edit.style))out.style=edit.style;if(typeof edit.hidden==='boolean')out.hidden=edit.hidden;o.partEdits[key]=out;}}
 if(v.type==='dim'){
  if(v.curvePoints&&['radius','diameter','arcLength','chordLength'].includes(o.kind)){if(!Array.isArray(v.curvePoints)||v.curvePoints.length<2||v.curvePoints.length>30001)throw Error('圆弧采样点无效');o.curvePoints=v.curvePoints.map(p);}
  for(const key of ['arcStart','arcSweep'])if(finite(v[key]))o[key]=v[key];
  for(const key of ['ref1','ref2'])if(o[key]){if(Number.isInteger(v[key].partIndex)&&v[key].partIndex>=0&&v[key].partIndex<=80000)o[key].partIndex=v[key].partIndex;if(['center','start','end'].includes(v[key].point))o[key].point=v[key].point;}
 }
 if(v.type==='dim'&&v.measurement){const m=v.measurement,ref=r=>{if(!r||typeof r.id!=='string'||r.id.length>100||!Number.isInteger(r.index)||r.index<0||r.index>40000)throw Error('尺寸关联无效');const out={id:r.id,index:r.index};if(Number.isInteger(r.partIndex)&&r.partIndex>=0&&r.partIndex<=80000)out.partIndex=r.partIndex;if(['center','start','end'].includes(r.point))out.point=r.point;if(r.offset)out.offset=p(r.offset);return out;};if(m.mode==='point-line'){o.measurement={mode:m.mode,point:p(m.point),line:ref(m.line)};if(m.pointRef)o.measurement.pointRef=ref(m.pointRef);}else if(m.mode==='line-line'){o.measurement={mode:m.mode,line1:ref(m.line1),line2:ref(m.line2),station:finite(m.station)?Math.max(0,Math.min(1,m.station)):.5};}else if(m.mode==='line-length'){o.measurement={mode:m.mode,line:ref(m.line)};}else if(m.mode==='line-angle'){o.measurement={mode:m.mode,line1:ref(m.line1),line2:ref(m.line2),ray1:m.ray1===-1?-1:1,ray2:m.ray2===-1?-1:1};}else throw Error('距离标注类型无效');}
 if(v.type==='dim'){
  const intersection=spec=>{const ref=r=>{if(!r||typeof r.id!=='string'||r.id.length>100||!Number.isInteger(r.index)||r.index<0||r.index>80000||!Number.isInteger(r.partIndex)||r.partIndex<0||r.partIndex>80000)throw Error('交点关联无效');return {id:r.id,index:r.index,partIndex:r.partIndex};};if(!spec||typeof spec!=='object')throw Error('交点关联无效');const out={line1:ref(spec.line1),line2:ref(spec.line2)};if(spec.offset)out.offset=p(spec.offset);return out;};
  for(const key of ['intersection1','intersection2'])if(v[key])o[key]=intersection(v[key]);
  if(o.measurement&&v.measurement?.pointIntersection)o.measurement.pointIntersection=intersection(v.measurement.pointIntersection);
 }
 if(v.corner&&['line','arc'].includes(v.type)){
 const c=v.corner,ref=r=>{if(!r||typeof r.id!=='string'||r.id.length>100||!Number.isInteger(r.partIndex)||r.partIndex<0||r.partIndex>80000||![0,1].includes(r.end))throw Error('圆角 / 倒角关联无效');return {id:r.id,partIndex:r.partIndex,end:r.end};};if(!['fillet','chamfer'].includes(c.kind))throw Error('角部类型无效');o.corner={kind:c.kind,first:ref(c.first),second:ref(c.second)};for(const key of c.kind==='fillet'?['radius']:['distance1','distance2']){if(!finite(c[key])||c[key]<.05||c[key]>10000)throw Error('角部尺寸无效');o.corner[key]=c[key];}
 }
 if(typeof v.viewGroup==='string'&&v.viewGroup.length<=120&&['front','top','side','iso'].includes(v.projectionRole)){o.viewGroup=v.viewGroup;o.projectionRole=v.projectionRole;}
 // 保留白名单之外的已知属性，否则重新打开工程会丢掉线宽与文字排版
 if(v.type!=='dim'&&v.type!=='text'&&finite(v.width)&&v.width>0&&v.width<=10)o.width=v.width;
 if(v.type==='text'){if(v.textOffset)o.textOffset=p(v.textOffset);if(finite(v.textAngle))o.textAngle=v.textAngle;if(finite(v.textSize)&&v.textSize>=.5&&v.textSize<=20)o.textSize=v.textSize;}
 return o;});out.objects=normalizeProject(out.objects);out.inspection=I.validateOptions(raw.inspection,out.objects);return out;
}

function filename(state,ext){const title=(state.title||'三视图练习').replace(/[<>:"/\|?*\x00-\x1f]/g,'_').slice(0,70);return title+'.'+ext;}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
function exportProject(state,onSaved){download(new Blob([JSON.stringify({format:'sanview-studio',...state},null,2)],{type:'application/json'}),filename(state,'sanview'));if(onSaved)onSaved();}
root.SanviewDoc={fresh,validateDoc,filename,download,exportProject};
if(typeof module!=='undefined'&&module.exports)module.exports=root.SanviewDoc;
})(typeof window!=='undefined'?window:globalThis);
