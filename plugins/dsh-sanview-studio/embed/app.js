'use strict';
(()=>{
const D=Draft,I=DimensionInspection,M=ModelViews,S=DimensionTool,E=EditingTools,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const {pt,add,sub,mul,dist,round,fmt,esc,clone}=D;
const STORE='sanview-studio-v1',preferences=ToolPreferences.load(localStorage);
const {kindNames,partNames,typeNames,profileNames,diameterStyles,radiusStyles,distanceStyles}=AppNames;
const mode='edit';
const INSPECTION_ENABLED=false;
const hints={'move-view':'拖动整体平移 · 可先框选需要移动的对象',select:'点击或框选对象 · Shift 多选 · 拖动节点修改形状',line:'依次点击连续画线 · 右键结束，重新点击设置起点 · Shift 水平 / 垂直',poly:'依次点击节点 · Enter 完成 · 点击起点闭合',rect:'点击两个对角点画矩形 · 按住 Shift 画正方形',circle:'点击圆心，再点击圆周上的一点',text:'点击文字放置位置','dim-diameter':'点击一个圆，再点击放置直径尺寸','dim-radius':'点击一个圆，再点击放置半径尺寸','dim-angle':'依次点击角的顶点、第一边、第二边，再放置尺寸弧'};
let state=SanviewDoc.fresh(),selected=new Set(),tool='select',style=preferences.style;
const ui={dimensionEditing:false,activePart:null,activeNode:null};
let measureTargets=[],distanceDirection=null,profileKind='rect',numberEditor=null,lastPointerTap=null,arcMode='center',arcSweep=180,arcDirection='auto',diameterStyle='auto',radiusStyle='auto',arcLeader='auto';
let measurementHover=null,angleEdges=[],distanceStyle='auto',filletRadius=5,filletEdges=[],chamferDistance1=5,chamferDistance2=5,rectangleCursor=null;
let distanceDefaultDirection=null,distancePickMode=preferences.distancePickMode,distanceRepeat='single',distanceIntersections=true;
let editBoundary=null,offsetTarget=null,editHover=null,offsetDistance=5,precisionSignature='';
hints.pan='平移画布 · 拖动空白处或图形，不移动图纸对象';
hints.erase='橡皮擦 · 点击擦除一条边，按住拖动可连续擦除 · Ctrl+Z 撤销';
hints.split='按点分割 · 点击直线上的分割点，按 V 后可逐段选择、Delete 删除';
hints.extend='延伸 · 先选边界，再点击需要延长的端点一侧';
hints.offset='偏移边线 · 先选直线、圆或圆弧，再点击偏移侧';
hints['dim-distance']='距离 · 选择直线 / 边或两条平行线，再放置 · Shift 点击取点';
hints['fillet']='圆角 · 依次点击两条相交的边，自动生成相切圆弧';
hints.chamfer='倒角 · 依次点击两条相交的直边，按距离 1 / 距离 2 裁出斜边';
hints['dim-radius']='半径 · 点击圆或圆弧，再点击放置 · Tab 切换注法';
hints['dim-diameter']='直径 · 点击圆或圆弧，再点击放置 · Tab 切换注法';
hints['dim-arc']='弧长 · 点击圆弧，再点击放置尺寸弧 · 两端箭头落在弧上 · Tab 切换界线引出';
hints['dim-chord']='弦长 · 点击圆弧，再点击放置 · 尺寸线平行于弦 · 界线平行于弦的垂直平分线';
hints['dim-angle']='角度 · 选择两条直线；或 Shift 点击顶点，再点两边上的点和尺寸弧位置';
hints.arc='依次点击圆心、起点、终点 · Tab 切换方向';
const lineToolInfo={'line':['#i-line','直线 L'],'poly':['#i-poly','折线 P']};
const shapeToolInfo={'rect':['#i-rect','矩形 / 形体 B'],'circle':['#i-circle','圆 C']};
function syncGroupTool(next){const update=(selector,info)=>{const button=$(selector);if(!button||!info)return;button.dataset.tool=next;button.title=info[1]+' · 在弹出的选项里切换类型';button.setAttribute('aria-label',info[1]);button.querySelector('use').setAttribute('href',info[0]);};update('#line-tool',lineToolInfo[next]);update('#shape-tool',shapeToolInfo[next]);update('#corner-tool',{fillet:['#i-fillet','圆角 F'],chamfer:['#i-chamfer','倒角 Shift+F']}[next]);update('#edit-tool',{erase:['#i-erase','橡皮擦 X'],split:['#i-split','分割 S'],extend:['#i-extend','延伸 E'],offset:['#i-offset','偏移 O']}[next]);}
$('#fillet-radius').addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<.05||value>200){e.target.value=filletRadius;toast('圆角半径请设为 0.05–200 mm');return;}filletRadius=value;renderDraft();});
function arcHint(){return arcMode==='three'?'依次点击起点、圆弧上一点、终点':arcMode==='endpoints'?'依次点击起点、终点，再点击圆弧经过的位置':arcMode==='fixed'?`点击圆心，再点击起点 · ${fmt(arcSweep)}° 圆弧 · Tab 切换方向`:'依次点击圆心、起点、终点 · 默认短弧，Tab 切换另一侧';}

const activeLayer='drawing';
let undoStack=[],redoStack=[],draft=[],draftRefs=[],pointer=null,lastPlacement=null,currentSnap=null,drag=null,space=false,zoom=1,pan=pt(0,0),baseWidth=800,toastTimer,saveTimer,templateKind='step',textPos=null,dirty=false,clipboard=null,clipboardPastes=0,clipboardPasteGuard=0;
let inspectionRevision=0,inspectionCache=null,projectManager=null;
try{const saved=localStorage.getItem(STORE);if(saved)state=SanviewDoc.validateDoc(JSON.parse(saved));}catch(e){console.warn('Cannot restore drawing',e.message);}
({arcMode,arcSweep,arcDirection,profileKind,diameterStyle,radiusStyle,arcLeader,distanceStyle,filletRadius,chamferDistance1,chamferDistance2,offsetDistance,distanceDefaultDirection,distanceRepeat,distanceIntersections}=preferences);distanceDirection=distanceDefaultDirection;
function rememberTools(){Object.assign(preferences,{style,arcMode,arcSweep,arcDirection,profileKind,diameterStyle,radiusStyle,arcLeader,distanceStyle,filletRadius,chamferDistance1,chamferDistance2,offsetDistance,distancePickMode,distanceDefaultDirection,distanceRepeat,distanceIntersections});ToolPreferences.save(localStorage,preferences);}
const paper=$('#paper'),viewport=$('#viewport'),shell=$('#paper-shell');
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3400);}
function persist(){clearTimeout(saveTimer);$('#save-status').textContent='正在保存…';saveTimer=setTimeout(()=>{try{localStorage.setItem(STORE,JSON.stringify(state));if(projectManager)projectManager.save().catch(()=>{$('#save-status').textContent='工程库保存失败，请下载工程';});$('#save-status').textContent='已保存在本机';dirty=false;}catch{$('#save-status').textContent='请下载工程保存';}},350);}
window.addEventListener('pagehide',()=>{if(!dirty)return;clearTimeout(saveTimer);try{localStorage.setItem(STORE,JSON.stringify(state));}catch{}});
function snapshot(){return JSON.stringify(state);}
function begin(){return snapshot();}
function commit(before){if(before===snapshot())return;try{if(state.objects.some(o=>o.corner))state.objects=E.syncCorners(state.objects,JSON.parse(before).objects);}catch(error){state=JSON.parse(before);render();toast('无法保持关联角部：'+error.message);return;}undoStack.push(before);if(undoStack.length>80)undoStack.shift();redoStack=[];if(INSPECTION_ENABLED)state.inspection=I.validateOptions(state.inspection,state.objects);inspectionRevision++;dirty=true;persist();render();}
function mutate(fn){const before=begin();fn();commit(before);}
function history(redo=false){const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;if(!from.length)return;to.push(snapshot());state=JSON.parse(from.pop());inspectionRevision++;selected.clear();ui.activeNode=null;ui.activePart=null;cancelDraft();syncControls();dirty=true;persist();render();}
function replaceProject(doc,undo=[],redo=[]){
 state=SanviewDoc.validateDoc(doc);
 const clean=entries=>{const out=[];for(const value of entries.slice(-20)){try{const normalized=JSON.stringify(SanviewDoc.validateDoc(JSON.parse(value)));if(normalized!==out.at(-1))out.push(normalized);}catch{}}while(out.at(-1)===JSON.stringify(state))out.pop();return out;};
 undoStack=clean(undo);redoStack=clean(redo);selected.clear();ui.activeNode=null;ui.activePart=null;cancelDraft();inspectionRevision++;syncControls();render();fit();dirty=true;persist();
}
function visible(o){return o.type!=='dim'||state.showDimensions;}
function getInspection(){if(!inspectionCache||inspectionCache.revision!==inspectionRevision){let data;try{data=I.inspect(state.objects,{...state.inspection,scale:state.scale});}catch(error){console.warn('Dimension inspection',error);data={views:[],missing:null,extra:null,missingItems:[],extraItems:[],dimensions:[],pending:[{text:'当前图形尚不能可靠检查，请缩小检查范围或确认几何关联',ids:[]}]};}inspectionCache={revision:inspectionRevision,data};}return inspectionCache.data;}
function renderInspection(){
 if(!INSPECTION_ENABLED){$('#inspection-btn').hidden=true;return;}
 const button=$('#inspection-btn'),dialog=$('#inspection-dialog');if(!button)return;const settings=state.inspection||I.validateOptions(null,state.objects);$('#inspection-toggle').checked=settings.enabled;
 if(!settings.enabled&&!dialog.open){button.textContent='尺寸检查';button.classList.remove('inspection-has-issues');return;}
 const r=getInspection(),count=n=>n==null?'—':n;button.textContent=settings.enabled?`多标 ${count(r.extra)} · 漏标 ${count(r.missing)}${r.pending.length?' · 待确认':''}`:'尺寸检查';button.classList.toggle('inspection-has-issues',settings.enabled&&!!(r.extra||r.missing||r.pending.length));
 if(!dialog.open)return;const body=$('#inspection-body'),oldViews=$('#inspection-view-options')?.open,oldRefs=$('#inspection-references')?.open,labels=Object.fromEntries(r.views.map(v=>[v.id,v.label])),dimLabels=Object.fromEntries(r.dimensions.map(d=>[d.id,d.label]));
 const locate=(kind,index,ids)=>ids?.length?`<button class="inspection-locate" data-inspection-locate="${kind}" data-index="${index}">定位</button>`:'';
 const misses=r.missingItems.map((item,i)=>`<li><div><b>${esc(labels[item.viewId]||'')} ${esc(item.label)}</b><small>${Number.isFinite(item.value)?'可补充约 '+fmt(item.value/state.scale)+' mm 的独立尺寸关系':`还缺 ${item.count||1} 项独立关系`}；也可用等效尺寸组合确定</small></div>${locate('missing',i,item.ids)}</li>`).join('');
 const extras=r.extraItems.map((item,i)=>`<li><div><b>重复约束，多 ${item.count} 项</b><small>${esc(item.ids.map(id=>dimLabels[id]||'尺寸').slice(0,8).join('、'))} 包含可由其他尺寸确定的信息；可选择保留其中独立的标注</small></div>${locate('extra',i,item.ids)}</li>`).join('');
 const pending=r.pending.map((item,i)=>`<li><div><b>${esc(item.text)}</b></div>${locate('pending',i,item.ids)}</li>`).join('');
 const roleNames={single:'单视图',front:'长 × 高',top:'长 × 宽',side:'宽 × 高',ignore:'忽略'},viewRows=r.views.map(v=>{const box=v.box,pad=3,viewObjects=state.objects.filter(o=>v.ids.includes(o.id)),config=settings.views?.[v.id]||{};return `<div class="inspection-view"><svg viewBox="${box.x-pad} ${box.y-pad} ${Math.max(8,box.right-box.x+pad*2)} ${Math.max(8,box.bottom-box.y+pad*2)}" aria-label="${esc(v.label)}预览">${viewObjects.map(o=>D.renderShape(o)).join('')}</svg><div><div class="inspection-view-title">${esc(v.label)}<button class="inspection-locate" data-inspection-view="${esc(v.id)}">定位</button></div><select aria-label="${esc(v.label)}对应方向" data-inspection-role="${esc(v.id)}">${[['auto','自动识别 · '+roleNames[v.role]],['single','单独检查'],['front','长 × 高'],['top','长 × 宽'],['side','宽 × 高'],['ignore','忽略此图']].map(([value,label])=>`<option value="${value}" ${value===(config.role||'auto')?'selected':''}>${label}</option>`).join('')}</select><div class="inspection-flips"><label><input type="checkbox" data-inspection-flip="flipX" data-view="${esc(v.id)}" ${v.flipX?'checked':''}>横向翻转</label><label><input type="checkbox" data-inspection-flip="flipY" data-view="${esc(v.id)}" ${v.flipY?'checked':''}>纵向翻转</label></div></div></div>`;}).join('');
 body.innerHTML=`<div class="inspection-totals"><div><b>${count(r.extra)}</b><span>多标</span></div><div><b>${count(r.missing)}</b><span>漏标</span></div><div><b>${r.pending.length}</b><span>待确认</span></div></div><p class="inspection-note">${r.complete?'在当前几何关系和视图对应下，尺寸信息已完整且独立。':r.pending.length?'含待确认关系，以下数量为推定结果。':'按独立尺寸关系统计，下面给出一种等效的补标或取舍方向。'}检查只作提示，不修改图纸。</p>${misses?`<div class="inspection-section-title">漏标关系</div><ul class="inspection-results">${misses}</ul>`:''}${extras?`<div class="inspection-section-title">多标关系</div><ul class="inspection-results">${extras}</ul>`:''}${pending?`<div class="inspection-section-title">待确认</div><ul class="inspection-results inspection-pending">${pending}</ul>`:''}<details id="inspection-view-options" ${oldViews||r.pending.length?'open':''}><summary>视图与对应 <span>${r.views.length} 个图形组</span></summary><p class="inspection-note">一个视图检查本身；多个投影视图合并考虑长、宽、高。同一构件可不对齐放置，必要时确认方向。示意图可设为忽略。</p><div class="inspection-views">${viewRows||'<p class="inspection-note">尚未识别到检查视图</p>'}</div><label class="check-row"><input type="checkbox" id="inspection-depth" ${settings.depthConfirmed?'checked':''}>已确认俯、侧视图内部特征及宽方向对应</label>${settings.groups?.length?`<label class="check-row"><input type="checkbox" id="inspection-only-manual" ${settings.onlyManual?'checked':''}>仅检查手动指定的视图</label>`:''}<div class="inspection-group-actions"><button class="btn" id="inspection-group-selected" ${[...selected].some(id=>state.objects.some(o=>o.id===id&&o.type!=='dim'&&o.type!=='text'))?'':'disabled'}>将所选图形作为检查视图</button><button class="text-btn" id="inspection-reset-groups">恢复自动识别</button></div></details><details id="inspection-references" ${oldRefs?'open':''}><summary>参考 / 排除尺寸 <span>${settings.referenceIds?.length||0} 项</span></summary><p class="inspection-note">勾选的尺寸不参与多漏标统计，图纸上的标注保持原样。</p><div class="inspection-reference-list">${r.dimensions.map(d=>`<label><input type="checkbox" data-inspection-reference="${esc(d.id)}" ${d.reference?'checked':''}><span>${esc(d.label)}</span><small>${d.inactive?'隐藏 / 空白':d.unresolved?'未识别':esc(labels[d.viewId]||'')}</small></label>`).join('')}</div></details><p class="inspection-footnote">按明确的水平、垂直、相接、相切、同心、对称轴和投影关系推定。统计尺寸信息的独立性，不检查数字、符号、线型或字向是否正确。隐藏或空白数字不计作已给尺寸；整体显隐不影响统计。复杂 SVG 曲线、投影歧义须人工确认。</p>`;
}
function locateInspection(ids){$('#inspection-dialog').close();setTool('select');selected=new Set(ids.filter(id=>state.objects.some(o=>o.id===id)));render();}
$('#inspection-btn').addEventListener('click',()=>{if(!INSPECTION_ENABLED)return;$('#tool-options').hidden=true;if(!state.inspection.enabled)mutate(()=>state.inspection.enabled=true);$('#inspection-dialog').showModal();renderInspection();});
$('#inspection-toggle').addEventListener('change',e=>mutate(()=>state.inspection.enabled=e.target.checked));
$('#inspection-body').addEventListener('change',e=>{const role=e.target.dataset.inspectionRole,flip=e.target.dataset.inspectionFlip,reference=e.target.dataset.inspectionReference;if(role)mutate(()=>{state.inspection.views[role]={...state.inspection.views[role],role:e.target.value};state.inspection.depthConfirmed=false;});else if(flip)mutate(()=>{const id=e.target.dataset.view;state.inspection.views[id]={role:'auto',...state.inspection.views[id],[flip]:e.target.checked};state.inspection.depthConfirmed=false;});else if(reference)mutate(()=>{const ids=new Set(state.inspection.referenceIds);if(e.target.checked)ids.add(reference);else ids.delete(reference);state.inspection.referenceIds=[...ids];});else if(e.target.id==='inspection-depth')mutate(()=>state.inspection.depthConfirmed=e.target.checked);else if(e.target.id==='inspection-only-manual')mutate(()=>state.inspection.onlyManual=e.target.checked);});
$('#inspection-body').addEventListener('click',e=>{const locate=e.target.closest('[data-inspection-locate]'),view=e.target.closest('[data-inspection-view]');if(locate){const r=getInspection(),items={missing:r.missingItems,extra:r.extraItems,pending:r.pending}[locate.dataset.inspectionLocate];locateInspection(items?.[Number(locate.dataset.index)]?.ids||[]);}else if(view)locateInspection(getInspection().views.find(v=>v.id===view.dataset.inspectionView)?.ids||[]);else if(e.target.closest('#inspection-reset-groups'))mutate(()=>{state.inspection.views={};state.inspection.groups=[];state.inspection.onlyManual=false;state.inspection.depthConfirmed=false;});else if(e.target.closest('#inspection-group-selected')){const ids=state.objects.filter(o=>selected.has(o.id)&&!['dim','text'].includes(o.type)&&!['thin','center'].includes(o.style)).map(o=>o.id);if(!ids.length){toast('请先框选轮廓或隐藏线');return;}mutate(()=>{state.inspection.groups=state.inspection.groups.map(g=>({...g,ids:g.ids.filter(id=>!ids.includes(id))})).filter(g=>g.ids.length);state.inspection.groups.push({id:'manual-'+D.id(),ids});state.inspection.onlyManual=true;});}});
function objectMarkup(o,interactive=true){
 const sel=selected.has(o.id);
 const body=D.renderShape(o,{scale:state.scale,font:state.font,blank:false});
 const hit=interactive?`<g class="hit">${o.type==='dim'?body:D.renderShape({...o,width:3.5})}</g>`:'';
 return `<g ${interactive?`data-id="${esc(o.id)}" class="entity ${sel?'selected':''} "`:''} ${!interactive?'color="#17241d"':''}>${body}${hit}</g>`;
}
function updateLinked(){D.updateLinked(state.objects);}
function render(){
 updateLinked();paper.classList.toggle('drawing',!['select','pan','move-view'].includes(tool)&&mode==='edit');paper.classList.toggle('panning',tool==='pan');paper.classList.toggle('preview',mode!=='edit');
 $('#grid-layer').innerHTML=state.grid?'<rect width="297" height="210" fill="url(#paper-grid)"/><rect width="297" height="210" fill="url(#paper-grid-major)"/>':'';
 for(const [id,k] of [['paper-grid',1],['paper-grid-major',5]]){const g=state.gridStep*k,node=$('#'+id);node.setAttribute('width',g);node.setAttribute('height',g);node.firstElementChild.setAttribute('d',`M${g} 0H0V${g}`);}
 $('#objects-layer').innerHTML=D.drawingOrder(state.objects.filter(o=>visible(o))).map(o=>objectMarkup(o)).join('');
 renderSelection();renderDraft();renderInspector();
 $('#object-count').textContent=state.objects.length+' 对象';
 $('#selection-btn').disabled=!selected.size;$('#copy-btn').disabled=!selected.size;paper.classList.toggle('dimension-editing',ui.dimensionEditing);
 $('#rotate-btn').disabled=!selected.size;
 paper.classList.toggle('erasing',tool==='erase');
 const mirrorable=state.objects.some(o=>selected.has(o.id)&&!['dim','text'].includes(o.type));for(const button of $$('[data-mirror-axis]'))button.disabled=!mirrorable;
 $('#undo-btn').disabled=!undoStack.length;$('#redo-btn').disabled=!redoStack.length;
 renderInspection();
}
function renderSelection(){const sel=$('#selection-layer');if(drag?.kind==='marquee'){const a=drag.start,b=drag.end;sel.innerHTML=`<rect x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(b.x-a.x)}" height="${Math.abs(b.y-a.y)}" fill="#008be812" stroke="#008be8" stroke-width=".25" pointer-events="none"/>`;return;}if(mode!=='edit'){sel.innerHTML='';return;}let content='';for(const o of state.objects.filter(o=>selected.has(o.id)&&visible(o))){
 if(tool==='move-view')continue;
 if(o.type==='dim'){if(ui.dimensionEditing){for(const part of D.dimensionParts(o,{scale:state.scale,font:state.font}).filter(p=>!p.hidden)){const active=ui.activePart?.id===o.id&&ui.activePart.key===part.id;content+=partHandle(part.point,part.id,'move',o.id,active);if(active)for(const [key,p] of Object.entries(part.handles||{}))content+=partHandle(p,part.id,key,o.id,true);}}else{content+=handle(o.pos,'pos',o.id);if(!o.hideText){const layout=D.dimensionLayout(o,{scale:state.scale,font:state.font}),angle=(Number.isFinite(o.textAngle)?o.textAngle:layout.angle||0)*Math.PI/180,rotationPoint=add(layout.point,pt(Math.cos(angle)*3.2,Math.sin(angle)*3.2));content+=`<line class="text-rotate-guide" x1="${layout.point.x}" y1="${layout.point.y}" x2="${rotationPoint.x}" y2="${rotationPoint.y}"/><circle class="node-handle rotate-handle" data-node="rotate" data-owner="${esc(o.id)}" cx="${rotationPoint.x}" cy="${rotationPoint.y}" r=".72" fill="white" stroke="#008be8" stroke-width=".28"/>`;}}continue;}
 if(o.corner)continue;const pts=editHandles(o);pts.forEach((p,i)=>content+=handle(p,i,o.id));}
 if(tool==='move-view'&&selected.size){const os=state.objects.filter(o=>selected.has(o.id)&&visible(o)),pts=os.flatMap(o=>o.type==='dim'?[o.pos,o.p1,o.p2,o.c].filter(Boolean):D.anchors(o));if(pts.length){const minX=Math.min(...pts.map(p=>p.x))-3,minY=Math.min(...pts.map(p=>p.y))-3,maxX=Math.max(...pts.map(p=>p.x))+3,maxY=Math.max(...pts.map(p=>p.y))+3;content=`<rect x="${minX}" y="${minY}" width="${maxX-minX}" height="${maxY-minY}" fill="none" stroke="#008be8" stroke-width=".25" stroke-dasharray="2 1.5" pointer-events="none"/>`;}}
 if(selected.size&&['select','move-view'].includes(tool)){
  const b=selectionBounds(),unit=1/(paper.getScreenCTM()?.a||1);
  if(b){
   const gap=7*unit,top=b.y-gap,left=b.x-gap,width=b.width+gap*2,height=b.height+gap*2;
   const view=viewport.getBoundingClientRect(),m=paper.getScreenCTM(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
   const hx=clamp(b.x+b.width/2,Math.max(14*unit,(view.left+18-m.e)/m.a),Math.min(297-14*unit,(view.right-18-m.e)/m.a));
   const hy=clamp(top-26*unit,Math.max(14*unit,(view.top+18-m.f)/m.d),Math.min(210-14*unit,(view.bottom-18-m.f)/m.d));
   content=`<rect class="rotation-selection-box" x="${left}" y="${top}" width="${width}" height="${height}" rx="${3*unit}" fill="none" stroke="#008be8" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" pointer-events="none"/>`+content;
   content+=`<line x1="${hx}" y1="${top}" x2="${hx}" y2="${hy}" stroke="#008be8" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/><g data-selection-rotate="true" class="selection-rotation-handle" role="button" tabindex="0" aria-label="鼠标旋转所选对象" transform="translate(${hx} ${hy}) scale(${unit})"><title>拖动旋转；点击后移动鼠标，再点确认 · Shift 按 15° 步进 · Esc 取消</title><circle r="13" fill="white" stroke="#008be8" stroke-width="1.5"/><use href="#i-rotate" x="-8" y="-8" width="16" height="16" fill="none" stroke="#008be8" stroke-width="1.5" pointer-events="none"/></g>`;
  }
 }
 sel.innerHTML=content;
}
function selectionBounds(ids=selected){
 const boxes=[];for(const id of D.withCornerMembers(state.objects,ids)){const node=$(`#objects-layer > [data-id="${CSS.escape(id)}"]`);if(node){const b=node.getBBox();boxes.push(b);}}
 if(!boxes.length)return null;
 const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}
function handle(p,node,id){const r=Math.min(1.05,Math.max(.55,1.15/zoom));return `<circle class="node-handle" data-node="${node}" data-owner="${esc(id)}" cx="${p.x}" cy="${p.y}" r="${r}" fill="${ui.activeNode?.id===id&&ui.activeNode.index===node?'#202126':'#008be8'}" stroke="white" stroke-width=".28"/>`;}
function partHandle(p,key,node,id,active){return `<circle class="dimension-part-handle" data-part="${key}" data-part-node="${node}" data-owner="${esc(id)}" cx="${p.x}" cy="${p.y}" r="${active?.95:.7}" fill="${active?'#008be8':'white'}" stroke="#008be8" stroke-width=".25"/>`;}
function inspectorCtx(){return {state,selected,tool,ui,editHandles,renderSelection};}
function renderInspector(){Inspector.render(inspectorCtx());}
function editHandles(o){if(o.type==='line'||o.type==='profile')return [o.p1,o.p2];if(o.type==='arc'){const a=D.arcGeometry(o);return o.c?[o.c,a.p1,a.p3]:[o.p1,o.p2,o.p3];}if(o.type==='rect')return D.anchors(o).slice(0,4);if(o.type==='circle')return [o.c,pt(o.c.x+o.r,o.c.y)];return D.anchors(o);}
function currentObjects(){return state.objects.filter(o=>visible(o)&&o.type!=='dim');}
function moveSelection(delta){const objects=state.objects.filter(o=>selected.has(o.id));if(ui.dimensionEditing&&objects.length===1&&ui.activePart?.id===objects[0].id){const o=objects[0];if(ui.activePart.key==='number')o.textOffset=add(o.textOffset||pt(0,0),delta);else{const edit=o.partEdits?.[ui.activePart.key]||{};edit.offset=add(edit.offset||pt(0,0),delta);o.partEdits={...o.partEdits,[ui.activePart.key]:edit};}return;}if(objects.some(o=>o.type!=='dim'))D.translateGroup(state.objects,D.withAttachedDimensions(state.objects,selected),delta);else for(const o of objects)o.pos=add(o.pos,delta);}
function rawPoint(e){const p=paper.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const m=paper.getScreenCTM();if(!m)return pt(0,0);const q=p.matrixTransform(m.inverse());return pt(round(q.x,3),round(q.y,3));}
function getPoint(e,doSnap=true){let result=rawPoint(e);const m=paper.getScreenCTM();$('#coordinates').textContent=`X ${result.x.toFixed(2)}　Y ${result.y.toFixed(2)} mm`;
 currentSnap=null;if(!doSnap)return result;
 const drawingPoint=['line','poly','rect','circle','arc','text'].includes(tool)||(drag?.kind==='node'&&state.objects.find(o=>o.id===drag.id)?.type!=='dim'),start=draft.length?draft.at(-1):null,constrainPoint=p=>{if(start&&e.shiftKey&&drawingPoint)Object.assign(p,E.constrainDrawingPoint(tool,start,p));return p;};
 if(state.snaps.enabled===false||e.altKey)return constrainPoint(result);
 if(tool.startsWith('dim-')&&(draftRefs.length||measureTargets.length>=2||measureTargets[0]?.type==='line'||tool==='dim-angle'&&draft.length===3)){
  const data=measureTargets.length?distanceData(result):null,suggestion=state.snaps.projection&&S.suggestSpacing(data,result,state.objects);if(suggestion){result=suggestion.p;currentSnap={...suggestion,snapped:true};}return result;
 }
 const excluded=drag&&drag.kind==='node'?[drag.id]:drag&&drag.kind==='move'?[...selected]:[];
 const objs=currentObjects().filter(o=>!excluded.includes(o.id)),tol=(state.snaps.tolerance??3)/(m?.a||1),forceGrid=drawingPoint&&state.snaps.grid;
 const opts={...state.snaps,step:state.gridStep,forceGrid,tolerance:Math.max(.3,tol)};currentSnap=D.snap(result,objs,opts);result=currentSnap.p;
 if((!currentSnap.snapped||currentSnap.label.endsWith('mm 网格'))&&state.snaps.projection){let bestX,bestY,dx=Math.max(.3,tol*.8),dy=dx;if(tool==='poly'&&forceGrid)dx=dy=Math.min(state.gridStep*.45,tol*.8);const onGrid=n=>Math.abs(n/state.gridStep-Math.round(n/state.gridStep))<1e-7;for(const o of objs)for(const a of D.anchors(o)){if((!forceGrid||onGrid(a.x))&&Math.abs(a.x-result.x)<dx){bestX=a;dx=Math.abs(a.x-result.x);}if((!forceGrid||onGrid(a.y))&&Math.abs(a.y-result.y)<dy){bestY=a;dy=Math.abs(a.y-result.y);}}
  if(bestX||bestY){result=pt(bestX?bestX.x:result.x,bestY?bestY.y:result.y);if(forceGrid)result=D.snapGrid(result,state.gridStep);currentSnap={p:result,label:'对齐',projection:{x:bestX,y:bestY},snapped:true};}
 }
 constrainPoint(result);
 if(currentSnap)currentSnap.p=result;
 return result;
}
function pointRef(p){for(const o of currentObjects()){const index=D.anchors(o).findIndex(a=>dist(p,a)<.02);if(index>=0)return {id:o.id,index};for(const part of D.geometryParts(o))if(part.c&&dist(p,part.c)<.02)return {id:o.id,index:0,partIndex:part.index,point:'center'};}return null;}
function hitOwner(e){const id=e.target.closest('[data-id]')?.dataset.id||e.target.closest('[data-owner]')?.dataset.owner;return state.objects.find(o=>o.id===id);}
function partDistance(p,part){
 if(part.type==='line'){const hit=D.projectToSegment(p,[part.p1,part.p2]);if(!hit)return null;return {distance:dist(p,hit.p),p:hit.p};}
 if(part.type==='circle'||part.type==='arc'){const q=D.closestCurvePoint(p,part);return q?{distance:dist(p,q),p:q}:null;}
 if(part.type==='curve'||part.type==='ellipse'){let best=null;for(let i=0;i<=32;i++){const t=i/32,q=part.p1&&part.p2?add(mul(part.p1,1-t),mul(part.p2,t)):null;if(q&&(!best||dist(p,q)<best.distance))best={distance:dist(p,q),p:q};}return best;}
 return null;
}
function pickGeometryPart(e,p,types){const hit=hitOwner(e),objects=hit&&hit.type!=='dim'?[hit,...currentObjects().filter(o=>o.id!==hit.id)]:currentObjects();let best=null,minimum=Infinity;for(const owner of objects)for(const part of D.circularParts(owner)){if(!types.includes(part.type))continue;const near=partDistance(p,part);if(near&&near.distance<minimum){best={owner,part,p:near.p,distance:near.distance};minimum=near.distance;}}return minimum<=7/(paper.getScreenCTM()?.a||1)?best:null;}
function pickLine(e,p){const hit=hitOwner(e),objects=hit&&hit.type!=='dim'?[hit,...currentObjects().filter(o=>o.id!==hit.id)]:currentObjects();let best=null,minimum=Infinity;for(const o of objects)D.geometryParts(o).forEach(part=>{if(part.type!=='line')return;const hit=D.projectToSegment(p,[part.p1,part.p2]);if(!hit)return;const near=hit.p,t=hit.t,d=dist(p,near);if(d<minimum){best={type:'line',ref:{id:o.id,index:part.index,partIndex:part.index},p:near,station:t,segment:[part.p1,part.p2],distance:d};minimum=d;}});return minimum<=7/(paper.getScreenCTM()?.a||1)?best:null;}
function distanceData(pos){if(tool==='dim-distance'&&distancePickMode!=='auto'&&S.distanceStep(distancePickMode,measureTargets).pick!=='place')return null;const data=S.resolveDistance(measureTargets,pos,state.objects,{direction:distanceDirection});return data?{...data,distanceStyle}:null;}
function angleData(pos){if(measureTargets.length)return S.resolveAngle(measureTargets,pos);if(draft.length!==3)return null;if(angleEdges.length===2){const signs=S.angleSigns(angleEdges[0],angleEdges[1],draft[1],draft[2]);const linked=S.resolveAngle(angleEdges,pos,signs);if(linked)return linked;}return {kind:'angle',c:draft[0],p1:draft[1],p2:draft[2],pos};}
function measurementTarget(e,p){
 const step=tool==='dim-distance'?S.distanceStep(distancePickMode,measureTargets):{pick:'auto'};if(step.pick==='line'){const line=pickLine(e,rawPoint(e));return line?{...line,entity:true}:{type:'none',entity:false};}
 if(tool==='dim-distance'&&distanceIntersections&&state.snaps.enabled&&!e.altKey){const intersection=S.pickIntersection(rawPoint(e),currentObjects(),(state.snaps.tolerance??3)/(paper.getScreenCTM()?.a||1));if(intersection)return intersection;}
 const forcePoint=e.shiftKey||step.pick==='point',raw=rawPoint(e),line=pickLine(e,raw),hit=!forcePoint&&pickGeometryPart(e,raw,['circle','arc']),
  curve=hit?{type:'point',p:{...hit.part.c},ref:{id:hit.owner.id,index:0,partIndex:hit.part.index,point:'center'},distance:hit.distance,center:true}:null,
  snapped=forcePoint&&state.snaps.enabled&&!e.altKey?D.snap(raw,currentObjects(),{object:true,grid:false,intersection:state.snaps.intersection,tolerance:(state.snaps.tolerance??3)/(paper.getScreenCTM()?.a||1)}):null,
  exact=forcePoint?(snapped?.snapped?snapped.p:raw):p,
  ref=pointRef(exact),point={type:'point',p:exact,ref,entity:!!ref||!!forcePoint};
 return S.pickTarget({line,curve,point,forcePoint});
}
function syncDistanceOptions(){
 $$('[data-distance-direction]').forEach(button=>{const active=button.dataset.distanceDirection===(distanceDirection||'auto');button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 $$('[data-distance-pick]').forEach(button=>{const active=button.dataset.distancePick===distancePickMode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 $$('[data-distance-direction]').forEach(button=>{button.disabled=['point-line','lines'].includes(distancePickMode);button.title=button.disabled?'该测量方式固定取垂直距离':'';});
 $('#distance-repeat').value=distanceRepeat;
 $('#distance-intersections').checked=distanceIntersections;
}
function setDistanceOption(e){
 const direction=e.target.closest('[data-distance-direction]'),pick=e.target.closest('[data-distance-pick]');if(!direction&&!pick)return false;
 if(direction){distanceDefaultDirection=direction.dataset.distanceDirection==='auto'?null:direction.dataset.distanceDirection;distanceDirection=distanceDefaultDirection;}
 if(pick){const next=pick.dataset.distancePick;if(next!==distancePickMode){cancelDraft();distancePickMode=next;if(next!=='points')distanceRepeat='single';}}
 syncDistanceOptions();renderDraft();const data=hasDraft()&&distanceData(pointer||lastPlacement||draft.at(-1));
 $('#tool-status').textContent=dimensionHint();return true;
}
function cornerClick(e,p){
 const edge=pickLine(e,p);
 if(!edge){toast('请点选一条直线作为'+(tool==='chamfer'?'倒角':'圆角')+'的边');return;}
 if(filletEdges.length===1){
  const first=filletEdges[0];
  let result;try{result=tool==='chamfer'?E.chamfer(state.objects,first.ref,edge.ref,chamferDistance1,chamferDistance2):E.fillet(state.objects,first.ref,edge.ref,filletRadius);}catch(error){toast(error.message);return;}
  mutate(()=>{state.objects=result.objects;selected=new Set([(result.arc||result.line).id]);});
  cancelDraft();toast(tool==='chamfer'?'已生成倒角，距离 '+fmt(chamferDistance1)+' / '+fmt(chamferDistance2)+' mm':'已生成圆角，半径 '+fmt(filletRadius)+' mm');
  return;
 }
 filletEdges=[edge];$('#tool-status').textContent='已选第一条边 · 再选另一条相交的边';
 renderDraft();
}
function editingTarget(e,p){
 const hit=E.pickEditablePart(currentObjects(),p,tool==='offset'?['line','circle','arc']:['line'],7/(paper.getScreenCTM()?.a||1),hitOwner(e)?.id);
 if(!hit)return null;
 return {...hit,ref:{id:hit.owner.id,partIndex:hit.part.index},segment:hit.part.type==='line'?[hit.part.p1,hit.part.p2]:null};
}
function editingPreview(p){
 if(!editBoundary||!editHover)return null;
 if(editBoundary.ref.id===editHover.ref.id&&editBoundary.ref.partIndex===editHover.ref.partIndex)return null;
 try{return E.trimEdge(editBoundary.segment,editHover.segment,p,true);}catch(error){return {error:error.message};}
}
function eraseTarget(e,p){
 const owner=hitOwner(e);if(owner&&['text','dim'].includes(owner.type))return {owner,part:null,ref:{id:owner.id},p,distance:0};
 const tolerance=7/(paper.getScreenCTM()?.a||1),hit=E.pickEditablePart(currentObjects(),p,['line','circle','arc'],tolerance,owner?.id,true);
 let curve=null;
 if(owner?.type==='path'){
  const parts=D.geometryParts(owner),matrix=owner.matrix||[1,0,0,1,0,0],scale=Math.max(Math.hypot(matrix[0],matrix[1]),Math.hypot(matrix[2],matrix[3]))*(paper.getScreenCTM()?.a||1);
  E.pathEntries(owner).forEach((entry,index)=>{
   if(!['curve','ellipse'].includes(parts[index]?.type))return;
   const path=document.createElementNS(D.NS,'path');path.setAttribute('d',D.pathD({segments:[{cmd:'M',v:[entry.start.x,entry.start.y]},entry.segment]}));
   const length=path.getTotalLength(),samples=Math.max(16,Math.min(256,Math.ceil(length*scale/4)));
   for(let i=0;i<=samples;i++){const raw=path.getPointAtLength(length*i/samples),q=D.transform(pt(raw.x,raw.y),matrix),distance=dist(p,q);if(!curve||distance<curve.distance)curve={owner,part:parts[index],p:q,distance,entry};}
  });
 }
 const best=curve&&curve.distance<=Math.max(tolerance,1.75)&&(!hit||hit.owner.id!==owner.id||curve.distance<hit.distance)?curve:hit;
 return best?{...best,ref:{id:best.owner.id,partIndex:best.part.index}}:null;
}
function splitTarget(e,p){
 const hit=E.pickEditablePart(currentObjects(),p,['line'],7/(paper.getScreenCTM()?.a||1),hitOwner(e)?.id,true);if(!hit)return null;
 const snapped=state.snaps.enabled&&!e.altKey?D.snap(p,currentObjects(),{object:state.snaps.object,intersection:true,grid:false,tolerance:(state.snaps.tolerance??3)/(paper.getScreenCTM()?.a||1)}):null;
 const point=D.projectToSegment(snapped?.snapped?snapped.p:p,[hit.part.p1,hit.part.p2]).p;
 return {...hit,p:point,ref:{id:hit.owner.id,partIndex:hit.part.index},segment:[hit.part.p1,hit.part.p2]};
}
function eraseAt(e,p){
 const hit=eraseTarget(e,p);if(!hit)return false;
 const result=E.erasePart(state.objects,hit.ref);state.objects=result.objects;selected.clear();editHover=null;ui.activeNode=null;ui.activePart=null;return true;
}
function eraseSweep(e,p){
 const stroke=drag;if(stroke?.kind!=='erase')return;
 const start=stroke.last,scale=paper.getScreenCTM()?.a||1,steps=Math.max(1,Math.min(160,Math.ceil(dist(start,p)*scale/5)));let changed=false;
 for(let i=1;i<=steps;i++){
  const point=add(start,mul(sub(p,start),i/steps));
  if(eraseAt(i===steps?e:{target:paper},point)){stroke.count++;changed=true;}
 }
 stroke.last=p;if(changed)render();
}
function cancelErase(){
 if(drag?.kind!=='erase')return;const stroke=drag;drag=null;state=JSON.parse(stroke.before);try{paper.releasePointerCapture(stroke.pointerId);}catch{}editHover=null;render();$('#tool-status').textContent=hints.erase;
}
function editingClick(e,p){
 if(tool==='split'){
  const hit=splitTarget(e,p);if(!hit){toast('请点击一条直线上的分割位置');return;}
  try{const result=E.splitLine(state.objects,hit.ref,hit.p);mutate(()=>{state.objects=result.objects;selected.clear();});editHover=null;$('#tool-status').textContent='已分为两段 · 可继续分割；按 V 点选其中一段，Delete 删除';toast('已分为两段，可分别选择、删除');}catch(error){toast(error.message);}return;
 }
 editHover=editingTarget(e,p);
 if(tool==='offset'){
  if(!offsetTarget){if(editHover)offsetTarget=editHover;else{toast('请选择直线、圆或圆弧');return;}$('#tool-status').textContent='已选偏移边线 · 点击内外侧或左右侧，距离 '+fmt(offsetDistance)+' mm';}
  else{try{const object=E.offsetPart(offsetTarget.part,offsetDistance,p,offsetTarget.owner);mutate(()=>{state.objects.push(object);selected=new Set([object.id]);});cancelDraft();toast('已偏移 '+fmt(offsetDistance)+' mm');}catch(error){toast(error.message);}}
 }else{
  const edge=editHover;if(!edge){toast('请点击一条直边');return;}
  if(!editBoundary){editBoundary=edge;$('#tool-status').textContent='已选边界 · 点击需要延伸的端点一侧';}
  else{try{const objects=E.trimExtend(state.objects,editBoundary.ref,edge.ref,p,true);mutate(()=>{state.objects=objects;selected=new Set([edge.ref.id]);});cancelDraft();toast('已延伸边线');}catch(error){toast(error.message);}}
 }
 renderDraft();
}
function mirrorSelection(axis){
 const sources=state.objects.filter(o=>selected.has(o.id)&&!['dim','text'].includes(o.type));
 if(!sources.length){toast('请先选择要镜像的几何图形');return;}
 const points=sources.flatMap(o=>{const node=$(`[data-id="${CSS.escape(o.id)}"]`);if(!node)return D.anchors(o);const b=node.getBBox();return [pt(b.x,b.y),pt(b.x+b.width,b.y+b.height)];});
 if(!points.length){toast('没有可镜像的几何图形');return;}
 const key=axis==='x'?'x':'y',origin=(Math.min(...points.map(p=>p[key]))+Math.max(...points.map(p=>p[key])))/2,copies=sources.map(o=>E.mirrorShape(o,axis,origin)).filter(Boolean);
 mutate(()=>{state.objects.push(...copies);selected=new Set(copies.map(o=>o.id));});$('#tool-options').hidden=true;toast('已生成镜像副本，可直接拖动或在属性中调整位置');
}
let rotationSession=null;
function openRotation(){
 if(!selected.size||mode!=='edit')return;
 cancelDraft();$('#tool-options').hidden=true;
 const ids=new Set(selected),moving=E.rotationIds(state.objects,ids),box=selectionBounds(ids);if(!box)return;
 const x=box.x+box.width/2,y=box.y+box.height/2;
 rotationSession={ids,moving};$('#rotation-angle').value='0';$('#rotation-x').value=round(x,4);$('#rotation-y').value=round(y,4);$('#rotation-error').textContent='';
 $('#rotation-selection-count').textContent=`已选择 ${ids.size} 个对象${moving.size>ids.size?' · '+(moving.size-ids.size)+' 个关联对象跟随旋转':''}`;
 $('#rotation-dialog').showModal();previewRotation();$('#rotation-angle').focus();$('#rotation-angle').select();
}
function rotationValues(){
 const form=$('#rotation-form');if(!form.checkValidity())throw Error('请输入有效的角度和中心坐标');
 const angle=Number($('#rotation-angle').value),pivot=pt(Number($('#rotation-x').value),Number($('#rotation-y').value));
 if(![angle,pivot.x,pivot.y].every(Number.isFinite)||Math.abs(angle)>360000||Math.abs(pivot.x)>1e7||Math.abs(pivot.y)>1e7)throw Error('旋转数值超出范围');
 return {angle,pivot};
}
function previewRotation(){
 if(!rotationSession)return;
 try{
  const {angle,pivot}=rotationValues();applyRotationPreview(rotationSession.moving,angle,pivot);
  $('#rotation-error').textContent='';$('#apply-rotation').disabled=Math.abs(angle%360)<1e-9;
 }catch(error){$('#rotation-error').textContent=error.message;$('#apply-rotation').disabled=true;}
}
function applyRotationPreview(moving,angle,pivot){
 const transform=`rotate(${-angle%360} ${pivot.x} ${pivot.y})`;
 for(const node of $('#objects-layer').children)if(moving.has(node.dataset.id))node.setAttribute('transform',transform);
 $('#selection-layer').setAttribute('transform',transform);
 const unit=1/(paper.getScreenCTM()?.a||1);
 $('#guide-layer').innerHTML=`<circle cx="${pivot.x}" cy="${pivot.y}" r="${5*unit}" fill="white" stroke="#008be8" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path d="M${pivot.x-8*unit} ${pivot.y}h${16*unit}M${pivot.x} ${pivot.y-8*unit}v${16*unit}" stroke="#008be8" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
}
let rotationClickGuard=0;
function startMouseRotation(e,p){
 const box=selectionBounds();if(!box)return;
 cancelDraft();lastPointerTap=null;$('#tool-options').hidden=true;
 const pivot=pt(box.x+box.width/2,box.y+box.height/2),ids=new Set(selected);
 drag={kind:'rotation',ids,moving:E.rotationIds(state.objects,ids),pivot,lastAngle:Math.atan2(p.y-pivot.y,p.x-pivot.x)*180/Math.PI,total:0,angle:0,startScreen:pt(e.clientX,e.clientY),pointer:p,client:pt(e.clientX,e.clientY),pointerId:e.pointerId,moved:false,armed:false};
 paper.setPointerCapture(e.pointerId);shell.classList.add('rotating');updateMouseRotation(e);e.preventDefault();
}
function updateMouseRotation(e){
 if(drag?.kind!=='rotation')return;
 const p=getPoint(e,false),client=pt(e.clientX,e.clientY);
 if(dist(client,drag.startScreen)>3)drag.moved=true;
 if(dist(p,drag.pivot)>2/(paper.getScreenCTM()?.a||1))drag=E.rotationStep(drag,p,e.shiftKey);
 drag.pointer=p;drag.client=client;applyRotationPreview(drag.moving,drag.angle,drag.pivot);
 const label=$('#rotation-readout');label.hidden=false;label.textContent=fmt(drag.angle)+'°'+(e.shiftKey?' · 15°':'');label.style.left=Math.max(8,Math.min(innerWidth-130,e.clientX+18))+'px';label.style.top=Math.max(8,Math.min(innerHeight-40,e.clientY-32))+'px';
 $('#tool-status').textContent='旋转 '+fmt(drag.angle)+'° · '+(drag.armed?'再次点击确认':'松开鼠标应用；点击后可移动鼠标旋转')+' · Shift 15° · Esc 取消';
}
function clearMouseRotation(){
 if(drag?.kind!=='rotation')return null;
 const current=drag;drag=null;try{paper.releasePointerCapture(current.pointerId);}catch{}
 shell.classList.remove('rotating');$('#rotation-readout').hidden=true;$('#selection-layer').removeAttribute('transform');pointer=null;currentSnap=null;rotationClickGuard=Date.now();$('#tool-status').textContent=hints[tool]||'选择';return current;
}
function cancelMouseRotation(){if(!clearMouseRotation())return;render();}
function finishMouseRotation(){
 const gesture=drag;if(gesture?.kind!=='rotation')return;
 try{
  const objects=E.rotateSelection(state.objects,gesture.ids,gesture.angle,gesture.pivot);clearMouseRotation();
  mutate(()=>{state.objects=objects;ui.activeNode=null;ui.activePart=null;});render();if(Math.abs(gesture.angle%360)>1e-7)toast('已旋转 '+fmt(gesture.angle)+'°，可撤销');
 }catch(error){cancelMouseRotation();toast(error.message);}
}
$('#rotate-btn').addEventListener('click',openRotation);
$('#rotation-form').addEventListener('input',previewRotation);
$$('[data-rotation-angle]').forEach(button=>button.addEventListener('click',()=>{$('#rotation-angle').value=button.dataset.rotationAngle;previewRotation();}));
$('#cancel-rotation').addEventListener('click',()=>$('#rotation-dialog').close());
$('#rotation-dialog').addEventListener('close',()=>{rotationSession=null;$('#selection-layer').removeAttribute('transform');render();});
$('#rotation-form').addEventListener('submit',e=>{
 e.preventDefault();if(!rotationSession)return;
 try{
  const {angle,pivot}=rotationValues(),objects=E.rotateSelection(state.objects,rotationSession.ids,angle,pivot);
  rotationSession=null;$('#selection-layer').removeAttribute('transform');mutate(()=>{state.objects=objects;ui.activeNode=null;ui.activePart=null;});$('#rotation-dialog').close();toast('已旋转 '+fmt(angle)+'°，可撤销');
 }catch(error){$('#rotation-error').textContent=error.message;}
});
function hasDraft(){return !!(draft.length||measureTargets.length||filletEdges.length||editBoundary||offsetTarget);}
function stepBack(){
 if(editBoundary||offsetTarget){editBoundary=null;offsetTarget=null;editHover=null;}
 else if(hasDraft())({draft,draftRefs,measureTargets,angleEdges,filletEdges,distanceDirection}=E.backStep({draft,draftRefs,measureTargets,angleEdges,filletEdges,distanceDirection}));
 else return false;
 if(!hasDraft())lastPlacement=null;currentSnap=null;measurementHover=null;$('#tool-status').textContent=hasDraft()?'已退回上一步 · 继续选择或输入数值':tool==='arc'?arcHint():hints[tool];
 $('#tool-options').hidden=true;renderDraft();return true;
}
function finishCurrent(){
 if(!hasDraft())return false;
 if(tool==='poly'){if(draft.length<2){toast('至少需要两个节点');return false;}finishPoly();return true;}
 const placement=pointer||lastPlacement;if(!placement){toast('请先移动到放置位置，或输入精确数值');return false;}
 if(tool==='dim-distance'){const data=distanceData(placement);if(!data){toast('请先完成测量对象选择');return false;}return finishDimension(data);}
 if(tool==='dim-angle'){const data=angleData(placement);if(!data){toast('请先完成角的两边选择');return false;}return finishDimension(data);}
 drawClick({target:paper,shiftKey:false},placement);renderDraft();return true;
}
function syncDrawingConsole(){
 const precise=['line','poly','rect','circle','arc'].includes(tool),working=precise||tool.startsWith('dim-')||['fillet','chamfer','erase','split','extend','offset'].includes(tool),box=$('#drawing-console');
 box.hidden=!working;$('#precision-form').hidden=!precise;if(!working)return;
 const pending=hasDraft();$('#step-back-btn').disabled=!pending;let canFinish=pending;
 if(precise&&pending){const position=pointer||lastPlacement,o=position&&previewObject(position);canFinish=tool==='poly'?draft.length>=2:tool==='line'?!!o&&dist(o.p1,o.p2)>=.05:tool==='circle'?!!o&&o.r>=.05:tool==='rect'?!!o&&Math.abs(o.p2.x-o.p1.x)>=.05&&Math.abs(o.p2.y-o.p1.y)>=.05:!!o&&o.type==='arc'&&!!D.arcGeometry(o);}
 const edgePreview=editBoundary&&editingPreview(pointer||lastPlacement);if(editBoundary)canFinish=!!edgePreview&&!edgePreview.error;
 $('#finish-drawing-btn').disabled=!canFinish;
 let stage=tool==='poly'?(draft.length?'添加节点 · '+draft.length+' 点':'设置起点'):pending?'② 预览与放置':'① 选择对象';
 if(precise)stage=draft.length?(tool==='arc'?'圆弧 · 第 '+(draft.length+1)+' 个点':tool==='poly'?stage:'② 确定图形'):'① 设置'+(tool==='circle'||tool==='arc'&&['center','fixed'].includes(arcMode)?'圆心':'起点');
 if(tool==='line'&&draft.length)stage='② 设置下一段终点 · 右键结束连续画线';
 if(tool==='dim-distance'&&distancePickMode!=='auto')stage=S.distanceStep(distancePickMode,measureTargets).message;
 if(['fillet','chamfer'].includes(tool))stage=filletEdges.length?'② 选择第二条边':'① 选择第一条边';
 if(tool==='extend')stage=editBoundary?'② 选择延伸侧':'① 选择边界';if(tool==='erase')stage='点击擦除 · 拖动连续擦除';if(tool==='split')stage='点击直线上的分割点 · V 选择 / Delete 删除';
 if(tool==='offset')stage=offsetTarget?'② 选择偏移侧':'① 选择边线';
 if(edgePreview)stage=edgePreview.error|| '② 绿色部分将延伸 · 点击确认';
 $('#workflow-stage').textContent=stage;if(!precise)return;
 const first=$('#precision-1'),second=$('#precision-2'),p=pointer||lastPlacement||draft.at(-1)||pt(0,0),base=tool==='poly'?draft.at(-1):draft[0];
 let labels=['起点 X mm','起点 Y mm'],values=[p.x,p.y],note='可点击画布取点，也可输入坐标。';
 if(tool==='rect')note='点击两个对角点画矩形，按住 Shift 画正方形。';
 if(!base&&(tool==='circle'||tool==='arc'&&['center','fixed'].includes(arcMode)))labels=['圆心 X mm','圆心 Y mm'];
 if(base){
  const angle=Math.atan2(base.y-p.y,p.x-base.x)*180/Math.PI,r=dist(base,p);
  if(tool==='rect'){labels=['宽 ΔX mm','高 ΔY mm'];values=[p.x-base.x,p.y-base.y];note='按住 Shift 画正方形；正值向右、向下，负值向左、向上。';}
  else if(tool==='circle'){labels=['半径 mm','直径 mm'];values=[r,r*2];note='输入半径或直径，另一项自动换算。';}
  else if(tool==='arc'&&['three','endpoints'].includes(arcMode)){labels=['下一点 X mm','下一点 Y mm'];note='输入下一取点位置，Enter 确认。';}
  else{labels=tool==='arc'?['半径 mm',draft.length>1?'终点角度 °':'起始角度 °']:['长度 mm','角度 °'];values=[tool==='arc'&&draft.length>1?dist(base,draft[1]):r,angle];note='角度向逆时针增加；0° 向右，90° 向上。';}
 }
 first.readOnly=tool==='arc'&&['center','fixed'].includes(arcMode)&&draft.length>1;
 const signature=[tool,arcMode,draft.length].join(':');
 $('#precision-label-1').textContent=labels[0];$('#precision-label-2').textContent=labels[1];first.setAttribute('aria-label',labels[0]);second.setAttribute('aria-label',labels[1]);$('#precision-note').textContent=note;
 if(signature!==precisionSignature||!$('#precision-form').contains(document.activeElement)){first.value=round(values[0],3);second.value=round(values[1],3);precisionSignature=signature;}
}
function refreshRectangleConstraint(e){
 if(tool!=='rect'||!draft.length||!rectangleCursor||drag||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]:not(#selection-dialog)'))return;
 pointer=getPoint({...rectangleCursor,shiftKey:e.type==='keydown',altKey:e.altKey});lastPlacement=pointer;renderDraft();
}
window.addEventListener('keydown',e=>{if(e.key==='Shift')refreshRectangleConstraint(e);});
window.addEventListener('keyup',e=>{if(e.key==='Shift')refreshRectangleConstraint(e);});
function precisionCandidate(){
 const one=Number($('#precision-1').value),two=Number($('#precision-2').value);
 if(!$('#precision-1').value.trim()||!$('#precision-2').value.trim())throw Error('请填写两个数值');
 if(tool==='circle'&&draft.length)return E.precisionPoint(tool,draft,one,0);
 return E.precisionPoint(tool,draft,one,two,arcMode);
}
$('#precision-form').addEventListener('input',e=>{
 if(tool==='circle'&&draft.length){if(e.target.id==='precision-2')$('#precision-1').value=Number(e.target.value)/2;else $('#precision-2').value=Number(e.target.value)*2;}
 try{pointer=precisionCandidate();lastPlacement=pointer;currentSnap=null;renderDraft();}catch{pointer=null;lastPlacement=null;currentSnap=null;renderDraft();}
});
$('#precision-form').addEventListener('submit',e=>{e.preventDefault();try{const p=precisionCandidate();pointer=p;lastPlacement=p;drawClick({target:paper,shiftKey:false},p);renderDraft();}catch(error){toast(error.message);}});
$('#precision-form').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();stepBack();e.target.blur();}});
$('#step-back-btn').addEventListener('click',stepBack);$('#finish-drawing-btn').addEventListener('click',finishCurrent);
function openProperties(){renderInspector();if(!$('#selection-dialog').open)$('#selection-dialog').show();document.body.classList.add('properties-open');setTimeout(fit,220);}
$('#selection-dialog').addEventListener('close',()=>{document.body.classList.remove('properties-open');setTimeout(fit,220);});
function finishDimension(data){
 if(!data||D.dimValue(data)<.01){toast('该方向尺寸为 0，可在距离选项中切换方向');return false;}
 const continuing=tool==='dim-distance'&&distanceRepeat!=='single'&&measureTargets.length===2&&measureTargets.every(t=>t.type==='point')?clone(measureTargets[distanceRepeat==='baseline'?0:1]):null;
 const object=D.shape('dim',{...data,role:'given',override:''},'dims');mutate(()=>{state.objects.push(object);selected=new Set([object.id]);});cancelDraft();
 if(continuing){measureTargets=[continuing];draft=[continuing.p];lastPlacement=continuing.p;$('#tool-status').textContent=(distanceRepeat==='baseline'?'基线标注 · 已保留首点':'连续标注 · 已保留上一点')+'，选择下一点后放置尺寸';renderDraft();}
 return true;
}
function distanceClick(e,p){
 if(distancePickMode!=='auto'){
  const step=S.distanceStep(distancePickMode,measureTargets);if(step.pick==='place'){finishDimension(distanceData(p));return;}
  const target=measurementTarget(e,p);if(!target.entity||target.type!==step.pick){toast(step.message);return;}
  const next=[...measureTargets,target];if(next.length===2){const result=S.resolveDistance(next,p,state.objects,{direction:distanceDirection});if(!result){toast('请选择另一条平行直线；当前两线无法测距');return;}if(D.dimValue(result)<.01){toast('测量值为 0，请换一个点、直线或测量方向');return;}}
  measureTargets=next;draft=next.map(t=>t.p);$('#tool-status').textContent=S.distanceStep(distancePickMode,next).message;renderDraft();return;
 }
 if(measureTargets.length===2){finishDimension(distanceData(p));return;}
 const target=measurementTarget(e,p);
 if(measureTargets.length===1&&measureTargets[0].type==='line'&&!target.entity&&!e.shiftKey){finishDimension(distanceData(p));return;}
 if(!target.entity){toast('请点选直线或圆心；需要点尺寸时按住 Shift 点击取点');return;}
 const previous=measureTargets.slice();measureTargets.push(target);
 if(measureTargets.length===2){const data=distanceData(p);if(!data||D.dimValue(data)<.01){measureTargets=previous;toast(data?'该方向尺寸为 0，请换一个点或切换测量方向':'请选择另一条平行线；非平行两线请使用角度工具');return;}draft=[data.p1,data.p2];$('#tool-status').textContent=data.measurement?.mode==='line-line'?'已选两条直线 · 移动并点击放置两线距离':data.measurement?.mode==='point-line'?'已明确选中点和直线 · 点击放置垂直距离':'已选两个点 · 当前为'+(data.kind==='aligned'?'直线距离':data.kind==='horizontal'?'水平距离':'垂直距离')+' · 移动后放置，Tab 切换方向';}
 else{draft=[target.p];$('#tool-status').textContent=target.type==='line'?'已选直线 · 再选另一条平行线；或点空白处放置边长':(target.intersection?'已选交点':'已选点 / 圆心')+' · 再选交点、直线，或用两点取距选择下一点';}
 renderDraft();
}
function angleClick(e,p){
 if(measureTargets.length===2||draft.length===3){const data=angleData(p);if(data&&dist(p,data.c)>=1)finishDimension(data);return;}
 if(measureTargets.length||!draft.length){const target=measurementTarget(e,p);if(target.type==='line'){
  if(measureTargets.length&&!S.resolveAngle([measureTargets[0],target],p)){toast('请选择两条不平行的直线');return;}
  measureTargets.push(target);draft=measureTargets.map(t=>t.p);$('#tool-status').textContent=measureTargets.length===1?'已选第一条边 · 再选另一条边':'两线夹角 · 移动位置选择锐角 / 钝角，再点击放置';renderDraft();return;
 }if(measureTargets.length){toast('请点击第二条直线；Esc 重新选择');return;}}
 if(draft.length&&dist(p,draft[0])<.1){toast('边上的点不能与顶点重合');return;}
 if(draft.length===2&&!D.arcThrough(draft[1],draft[0],p)){toast('请选择不共线的两个方向');return;}
 if(draft.length>=1){const edge=pickLine(e,p);if(edge&&angleEdges.length<2)angleEdges.push(edge);}draft.push(p);$('#tool-status').textContent=draft.length===1?'已选顶点 · 点击第一边上的点':draft.length===2?'点击第二边上的点':'移动预览，再点击放置角度';renderDraft();
}
function alignmentGuides(p,projected=false){if(!projected&&state.crosshair===false)return '';const gap=1.6,cls=projected?'alignment-guide projected':'cursor-crosshair';return `<line x1="${p.x}" y1="0" x2="${p.x}" y2="${Math.max(0,p.y-gap)}" class="${cls}"/><line x1="${p.x}" y1="${Math.min(210,p.y+gap)}" x2="${p.x}" y2="210" class="${cls}"/><line x1="0" y1="${p.y}" x2="${Math.max(0,p.x-gap)}" y2="${p.y}" class="${cls}"/><line x1="${Math.min(297,p.x+gap)}" y1="${p.y}" x2="297" y2="${p.y}" class="${cls}"/>`;}
function renderDraft(){syncDrawingConsole();let content='',guides='';const preview=pointer||(hasDraft()?lastPlacement:null);if(mode==='edit'&&preview){
 if(tool!=='erase')guides+=alignmentGuides(preview);
 if(tool==='dim-distance'&&measurementHover?.entity&&measureTargets.length<2){const hit=measurementHover;if(hit.type==='line')guides+=`<g color="#008be8" opacity=".5">${D.renderShape({type:'line',p1:hit.segment[0],p2:hit.segment[1],style:'solid'})}</g>`;else guides+=`<circle cx="${hit.p.x}" cy="${hit.p.y}" r="1" fill="none" stroke="#008be8" stroke-width=".3"/>`;content+=`<text x="${preview.x+1.8}" y="${preview.y-1.8}" font-size="2.5" fill="#008be8" stroke="white" stroke-width=".65" paint-order="stroke fill">${hit.type==='line'?'直线':hit.intersection?'交点':hit.center?'圆心':'点'}</text>`;if(hit.intersection){const r=4/(paper.getScreenCTM()?.a||1);guides+=`<path d="M${hit.p.x} ${hit.p.y-r}l${r} ${r}l${-r} ${r}l${-r} ${-r}Z" fill="white" stroke="#008be8" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;}}
 if(tool.startsWith('dim-')){for(const target of measureTargets){if(target.type==='line')guides+=`<g color="#008be8">${D.renderShape({type:'line',p1:target.segment[0],p2:target.segment[1],style:'solid'})}</g>`;else guides+=`<circle cx="${target.p.x}" cy="${target.p.y}" r=".75" fill="#008be8"/>`;}for(const ref of draftRefs){const source=state.objects.find(o=>o.id===ref.id),part=source&&D.geometryPart(source,ref.partIndex);if(part)guides+=`<g color="#008be8">${D.renderShape({...part,style:'solid'})}</g>`;}}
 if(filletEdges.length){const first=filletEdges[0];guides+=`<g color="#008be8">${D.renderShape({type:'line',p1:first.segment[0],p2:first.segment[1],style:'solid'})}</g>`;const next=pickLine({target:paper},preview);if(next&&(next.ref.id!==first.ref.id||next.ref.partIndex!==first.ref.partIndex)){if(tool==='chamfer'){try{const r=E.chamferGeometry(first.segment,next.segment,chamferDistance1,chamferDistance2);content+=`<g color="#008be8" opacity=".8">${D.renderShape({type:'line',p1:r.p1,p2:r.p2,style:'solid'})}</g>`;}catch{}}else{const r=D.filletBetween(first.segment,next.segment,filletRadius);if(r&&r.reach<r.length1&&r.reach<r.length2)content+=`<g color="#008be8" opacity=".8">${D.renderShape({type:'arc',c:r.center,r:r.r,startAngle:r.startAngle,sweepAngle:r.sweep,style:'solid'})}</g>`;}}}
 if(['erase','split','extend','offset'].includes(tool)){
  const edgeLine=(edge,color,dash='')=>`<line x1="${edge[0].x}" y1="${edge[0].y}" x2="${edge[1].x}" y2="${edge[1].y}" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke" ${dash?'stroke-dasharray="'+dash+'"':''}/>`;
  if(editBoundary)guides+=edgeLine(editBoundary.segment,'#008be8');
  if(editHover&&!offsetTarget){
   const color=tool==='erase'?'#e04454':'#008be8',hit=editHover;
   if(tool==='erase'&&hit.entry)guides+=`<g color="${color}">${D.renderShape({type:'path',segments:[{cmd:'M',v:[hit.entry.start.x,hit.entry.start.y]},hit.entry.segment],matrix:hit.owner.matrix,style:'solid'})}</g>`;
   else if(hit.segment)guides+=edgeLine(hit.segment,color);
   else guides+=`<g color="${color}">${D.renderShape(hit.part?{...hit.part,style:'solid'}:hit.owner,{scale:state.scale,font:state.font})}</g>`;
   if(tool==='split'){const radius=5/(paper.getScreenCTM()?.a||1);content+=`<circle cx="${hit.p.x}" cy="${hit.p.y}" r="${radius}" fill="white" stroke="#008be8" stroke-width="2" vector-effect="non-scaling-stroke"/>`;}
  }
  const result=editingPreview(preview);
  if(result&&!result.error){guides+=edgeLine(result.edge,'#15986e');guides+=edgeLine(result.changed,'#15986e');}
 }
 if(offsetTarget){guides+=`<g color="#008be8">${D.renderShape({...offsetTarget.part,style:'solid'})}</g>`;try{content+=`<g color="#008be8" opacity=".7">${D.renderShape(E.offsetPart(offsetTarget.part,offsetDistance,preview,offsetTarget.owner))}</g>`;}catch{}}
 if(tool==='arc'&&['center','fixed'].includes(arcMode)&&draft.length){const c=draft[0],r=arcMode==='fixed'&&draft.length>1?dist(c,draft[1]):dist(c,preview);guides+=`<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" opacity=".18"/>`;}
 if(tool==='arc'&&arcMode==='endpoints'&&draft.length===1)guides+=`<line x1="${draft[0].x}" y1="${draft[0].y}" x2="${preview.x}" y2="${preview.y}" class="alignment-guide"/>`;
 if(tool==='erase')content+=`<circle cx="${preview.x}" cy="${preview.y}" r="${7/(paper.getScreenCTM()?.a||1)}" fill="#e0445410" stroke="#e04454" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
 else if(!currentSnap?.snapped)content+=`<circle class="pointer-dot" cx="${preview.x}" cy="${preview.y}" r=".48" fill="#008be8" stroke="white" stroke-width=".18"/>`;
 if(currentSnap?.snapped){let p=currentSnap.p;content+=`<circle cx="${p.x}" cy="${p.y}" r=".85" fill="#008be8" stroke="white" stroke-width=".28"/>`;if(!currentSnap.label.endsWith("mm 网格"))content+=`<text x="${p.x+1.8}" y="${p.y-1.8}" font-size="2.5" fill="#008be8" stroke="white" stroke-width=".8" paint-order="stroke fill">${esc(currentSnap.label)}</text>`;
 if(currentSnap.projection){const proj=currentSnap.projection;if(proj.x||proj.y)guides+=alignmentGuides(p,true);}}
 if(draft.length){let o=previewObject(preview);if(o)content+=`<g color="#111111" opacity=".55">${D.renderShape(o,{scale:state.scale,font:state.font})}</g>`;if(tool==='poly'||tool==='arc')content+=draft.map((p,i)=>handle(p,i,'draft')).join('');}
 }
 $('#draft-layer').innerHTML=content;$('#guide-layer').innerHTML=`<g>${guides}</g>`;
}
function arcPreview(p){if(arcMode==='three')return draft.length<2?D.shape('line',{p1:draft[0],p2:p},activeLayer,'thin'):D.shape('arc',{p1:draft[0],p2:draft[1],p3:p},activeLayer,style);if(arcMode==='endpoints')return draft.length<2?D.shape('line',{p1:draft[0],p2:p},activeLayer,'thin'):D.shape('arc',{p1:draft[0],p2:p,p3:draft[1]},activeLayer,style);const c=draft[0];if(draft.length===1){const r=dist(c,p);if(r<.05)return null;return arcMode==='fixed'?D.shape('arc',{c:{...c},r,startAngle:D.arcAngle(c,p),sweepAngle:arcSweep*(arcDirection==='ccw'?-1:1)},activeLayer,style):D.shape('circle',{c,r},activeLayer,'thin');}const data=D.arcFromCenter(c,draft[1],p,arcDirection);return data?D.shape('arc',data,activeLayer,style):null;}
function previewObject(p){if(tool==='line')return D.shape('line',{p1:draft[0],p2:p},activeLayer,style);if(tool==='rect')return D.shape(profileKind==='rect'?'rect':'profile',{p1:draft[0],p2:p,...(profileKind==='rect'?{}:{profile:profileKind,radius:5})},activeLayer,style);if(tool==='circle')return D.shape('circle',{c:draft[0],r:dist(draft[0],p)},activeLayer,style);if(tool==='arc')return arcPreview(p);if(tool==='poly')return D.shape('poly',{points:[...draft,p],closed:false},activeLayer,style);
 if(tool==='dim-distance'){const data=distanceData(p);return data?{type:'dim',...data}:null;}
 if(tool.startsWith('dim-')){const k=tool.slice(4);if(k==='angle'){const data=angleData(p);if(data)return {type:'dim',...data};if(measureTargets.length)return null;return D.shape('poly',{points:[...(draft.length===1?[draft[0]]:[draft[1],draft[0]]),p],closed:false});}
 if(k==='diameter'||k==='radius'){const ref=draftRefs[0],source=ref&&state.objects.find(o=>o.id===ref.id),c=source&&D.circlePart(source,ref.partIndex);return c?{type:'dim',kind:k,c:c.c,r:c.r,pos:p,arcStart:c.startAngle,arcSweep:c.sweepAngle,curvePoints:c.curvePoints,...(k==='diameter'?{diameterStyle}:{radiusStyle})}:null;}
  if(k==='arc'||k==='chord'){const ref=draftRefs[0],source=ref&&state.objects.find(o=>o.id===ref.id),c=source&&D.circlePart(source,ref.partIndex);return c?{type:'dim',kind:k==='arc'?'arcLength':'chordLength',c:c.c,r:c.r,pos:p,arcStart:c.startAngle,arcSweep:c.sweepAngle,...(k==='arc'?(arcLeader==='auto'?{}:{arcLeader}):{})}:null;}
 if(draft.length===1)return D.shape('line',{p1:draft[0],p2:p},activeLayer,'thin');return {type:'dim',kind:k,p1:draft[0],p2:draft[1],pos:p};}
 return null;
}
function setTool(next){for(const [key,values] of Object.entries({lineTool:['line','poly'],shapeTool:['rect','circle'],cornerTool:['fillet','chamfer'],editTool:['erase','split','extend','offset']}))if(values.includes(next))preferences[key]=next;rememberTools();lastPointerTap=null;if(['erase','split'].includes(next))selected.clear();tool=next;syncGroupTool(next);cancelDraft();ui.activeNode=null;ui.activePart=null;if(['poly','arc','rect','circle'].includes(next)&&style==='center')style='solid';if(next==='move-view'&&selected.size)selected=D.withViewGroups(state.objects,selected);$$('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});$('#tool-status').textContent=next==='select'?'选择':next==='arc'?arcHint():next.startsWith('dim-')?dimensionHint():hints[next];showToolOptions(next);render();}
function dimensionHint(){return tool==='dim-distance'?S.distanceStep(distancePickMode,measureTargets).message:hints[tool]||'';}
function cancelDraft(){editBoundary=null;offsetTarget=null;editHover=null;precisionSignature='';draft=[];draftRefs=[];measureTargets=[];angleEdges=[];filletEdges=[];measurementHover=null;distanceDirection=distanceDefaultDirection;pointer=null;lastPlacement=null;currentSnap=null;$('#draft-layer').innerHTML='';$('#guide-layer').innerHTML='';$('#tool-status').textContent=tool==='select'?'选择':tool==='arc'?arcHint():tool.startsWith('dim-')?dimensionHint():hints[tool];syncDrawingConsole();}
function finishPoly(closed=false){if(draft.length>=2){const pts=clone(draft);mutate(()=>state.objects.push(D.shape('poly',{points:pts,closed},activeLayer,style)));}cancelDraft();}
function drawClick(e,p){
 if(['erase','split','extend','offset'].includes(tool)){editingClick(e,p);return;}
 if(['fillet','chamfer'].includes(tool)){cornerClick(e,p);return;}
 if(tool==='dim-distance'){distanceClick(e,p);return;}
 if(tool==='dim-angle'){angleClick(e,p);return;}
 if(tool==='arc'){const required=arcMode==='fixed'?1:2;if(draft.length<required){if(draft.length&&dist(p,draft[0])<.05)return;draft.push(p);return;}const o=arcPreview(p);if(!o||o.type!=='arc'||!D.arcGeometry(o)){toast(arcMode==='endpoints'?'圆弧经过点不能与起点、终点共线':arcMode==='three'?'圆弧的三个点不能重合或共线':'请选择与起点不同的圆弧终点');return;}mutate(()=>state.objects.push(o));selected=new Set([o.id]);cancelDraft();render();return;}
 if(tool==='text'){textPos=p;$('#text-value').value='';$('#text-dialog').showModal();$('#text-value').focus();return;}
 if(tool==='poly'){if(draft.length>=3&&dist(p,draft[0])<.05){finishPoly(true);return;}if(!draft.length||dist(p,draft.at(-1))>.05)draft.push(p);renderDraft();return;}
 if(tool.startsWith('dim-')){
  const k=tool.slice(4);
  if(k==='diameter'||k==='radius'){
   if(!draft.length){const hit=pickGeometryPart(e,getPoint(e,false),['circle','arc']);if(!hit){toast('请点击圆、圆弧或复合图形中的圆弧');return;}draft=[{...hit.part.c}];draftRefs=[{id:hit.owner.id,partIndex:hit.part.index}];$('#tool-status').textContent=`已选${hit.part.fitMethod==='fillet'?'折线圆角（拟合）':hit.part.type==='circle'?'圆':'圆弧'} · 再点击放置${k==='diameter'?'直径':'半径'}尺寸`;return;}
   const ref=draftRefs[0],source=state.objects.find(o=>o.id===ref.id),c=source&&D.circlePart(source,ref.partIndex);if(!c){toast('所选圆弧已改变，请重新选择');cancelDraft();return;}const o=D.shape('dim',{kind:k,c:{...c.c},r:c.r,pos:p,circleId:source.id,circlePart:ref.partIndex,arcStart:c.startAngle,arcSweep:c.sweepAngle,curvePoints:c.curvePoints,role:'given',override:'',...(k==='diameter'?{diameterStyle}:{radiusStyle})},'dims');mutate(()=>{state.objects.push(o);selected=new Set([o.id]);});cancelDraft();return;
  }
  if(k==='arc'||k==='chord'){
   // GB/T 4458.4 §4.1.5：弧长与弦长都针对一段圆弧；整圆没有起止角，先提示改用直径
   if(!draft.length){const hit=pickGeometryPart(e,getPoint(e,false),['arc']);if(!hit){toast('请点击一段圆弧；整圆请改用直径尺寸');return;}const part=hit.part;if(!Number.isFinite(part.startAngle)||!Number.isFinite(part.sweepAngle)||Math.abs(part.sweepAngle)<1e-6){toast('这段圆弧没有可用的起止角，无法标注弧长 / 弦长');return;}draft=[{...part.c}];draftRefs=[{id:hit.owner.id,partIndex:hit.part.index}];$('#tool-status').textContent=`已选圆弧 · 再点击放置${k==='arc'?'弧长':'弦长'}尺寸`;return;}
   const ref=draftRefs[0],source=state.objects.find(o=>o.id===ref.id),c=source&&D.circlePart(source,ref.partIndex);if(!c||!Number.isFinite(c.startAngle)||Math.abs(c.sweepAngle||0)<1e-6){toast('所选圆弧已改变，请重新选择');cancelDraft();return;}const kind=k==='arc'?'arcLength':'chordLength',o=D.shape('dim',{kind,c:{...c.c},r:c.r,pos:p,circleId:source.id,circlePart:ref.partIndex,arcStart:c.startAngle,arcSweep:c.sweepAngle,role:'given',override:'',...(k==='arc'&&arcLeader!=='auto'?{arcLeader}:{})},'dims');mutate(()=>{state.objects.push(o);selected=new Set([o.id]);});cancelDraft();return;
  }
  if(draft.length<2){if(draft.length&&((k==='horizontal'&&Math.abs(p.x-draft[0].x)<.05)||(k==='vertical'&&Math.abs(p.y-draft[0].y)<.05)||dist(p,draft[0])<.05)){toast('两个测量点需在标注方向上有间距');return;}draft.push(p);draftRefs.push(pointRef(p));}
  else {const o={kind:k,p1:draft[0],p2:draft[1],pos:p,role:'given',override:''};if(draftRefs[0])o.ref1=draftRefs[0];if(draftRefs[1])o.ref2=draftRefs[1];mutate(()=>state.objects.push(D.shape('dim',o,'dims')));cancelDraft();}return;
 }
 if(!draft.length){draft=[p];return;}const o=previewObject(p);if(tool==='circle'&&o.r<.05)return;if(tool==='line'&&dist(o.p1,o.p2)<.05)return;if(tool==='rect'&&(Math.abs(o.p2.x-o.p1.x)<.05||Math.abs(o.p2.y-o.p1.y)<.05))return;mutate(()=>state.objects.push(o));selected=new Set([o.id]);cancelDraft();if(tool==='line'){draft=[{...p}];pointer={...p};lastPlacement={...p};}render();
}
function editNode(o,index,p){if(o.type==='line'||o.type==='profile')o[index===0?'p1':'p2']=p;else if(o.type==='arc'){if(o.c){if(index===0)o.c=p;else if(index===1){const r=dist(p,o.c);if(r>.05){o.r=r;o.startAngle=D.arcAngle(o.c,p);}}else{const data=D.arcFromCenter(o.c,D.arcGeometry(o).p1,p,o.sweepAngle>0);if(data)o.sweepAngle=data.sweepAngle;}}else{const key=['p1','p2','p3'][index],copy={...o,[key]:p};if(D.arcThrough(copy.p1,copy.p2,copy.p3))o[key]=p;}}else if(o.type==='rect'){
 const pts=D.anchors(o);const opposite=pts[(index+2)%4];o.p1=pt(Math.min(p.x,opposite.x),Math.min(p.y,opposite.y));o.p2=pt(Math.max(p.x,opposite.x),Math.max(p.y,opposite.y));
 }else if(o.type==='circle'){if(index===0)o.c=p;else o.r=Math.max(.05,dist(p,o.c));}else if(o.type==='poly')o.points[index]=p;else if(o.type==='text')o.p=p;else if(o.type==='path'){
 const seg=o.segments.filter(s=>s.v.length)[index],q=D.inverse(p,o.matrix),delta=sub(q,pt(seg.v.at(-2),seg.v.at(-1)));seg.v[seg.v.length-2]=q.x;seg.v[seg.v.length-1]=q.y;
 if(['C','S','Q'].includes(seg.cmd)){seg.v[seg.v.length-4]+=delta.x;seg.v[seg.v.length-3]+=delta.y;}
 }else if(o.type==='dim'){if(index==='text'){const original=D.dimensionLayout({...o,textOffset:pt(0,0)},{scale:state.scale,font:state.font}).point;o.textOffset=sub(p,original);}else o.pos=p;}
}
function startPartDrag(o,key,node,p){ui.activePart={id:o.id,key};selected=new Set([o.id]);ui.activeNode=null;if(key==='number'){drag={kind:'text',id:o.id,start:p,before:begin(),original:clone(o)};return;}const part=D.dimensionParts(o,{scale:state.scale,font:state.font}).find(part=>part.id===key);if(!part)return;drag={kind:'part',id:o.id,key,node,start:p,before:begin(),part:clone(part),edit:clone(o.partEdits?.[key]||{})};}
function editPartDrag(o,d,p){const delta=sub(p,d.start),edit=clone(d.edit);if(d.node==='start'||d.node==='end')edit[d.node]=add(edit[d.node]||pt(0,0),delta);
 else if(d.node==='direction'||d.node==='radius'){const center=d.part.type==='arrow'?d.part.p:d.part.c,v=sub(p,center),originalAngle=d.part.type==='arrow'?Math.atan2(d.part.dir.y,d.part.dir.x):d.part.b;edit.angle=(edit.angle||0)+(Math.atan2(v.y,v.x)-originalAngle)*180/Math.PI;const size=d.part.type==='arrow'?d.part.size*2.5:d.part.r;edit.scale=Math.max(.05,Math.min(20,(d.edit.scale||1)*D.len(v)/(size||1)));}
 else edit.offset=add(edit.offset||pt(0,0),delta);o.partEdits={...o.partEdits,[d.key]:edit};}
paper.addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.button!==1)return;const raw=getPoint(e,false);
 if(drag?.kind==='rotation'){if(e.button===0){updateMouseRotation(e);finishMouseRotation();}else cancelMouseRotation();e.preventDefault();return;}
 if(e.button===0&&!space&&e.target.closest('[data-selection-rotate]')){startMouseRotation(e,raw);return;}
 if(e.button===1||space||tool==='pan'){drag={kind:'pan',start:pt(e.clientX,e.clientY),pan:{...pan}};paper.setPointerCapture(e.pointerId);e.preventDefault();return;}
 if(tool==='erase'){
  $('#tool-options').hidden=true;drag={kind:'erase',before:begin(),last:raw,count:0,pointerId:e.pointerId};paper.setPointerCapture(e.pointerId);pointer=raw;
  if(eraseAt(e,raw))drag.count++;render();e.preventDefault();return;
 }
 if(tool==='select'){const owner=e.target.closest('[data-id]')?.dataset.id||e.target.closest('[data-owner]')?.dataset.owner,o=state.objects.find(o=>o.id===owner),now=Date.now(),point=pt(e.clientX,e.clientY);if(o&&lastPointerTap?.id===o.id&&now-lastPointerTap.time<500&&dist(point,lastPointerTap.point)<7){lastPointerTap=null;selected=new Set([o.id]);const text=o.type==='dim'?$(`[data-id="${CSS.escape(o.id)}"] > .dimension [data-dim-text]`):null,b=text?.getBoundingClientRect();if(b&&e.clientX>=b.left-7&&e.clientX<=b.right+7&&e.clientY>=b.top-7&&e.clientY<=b.bottom+7)openNumberEditor(o);else{openProperties();}e.preventDefault();return;}lastPointerTap=o?{id:o.id,time:now,point}:null;}

 $('#tool-options').hidden=true;
 if(tool!=='select'&&tool!=='move-view'){if(tool==='rect')rectangleCursor={clientX:e.clientX,clientY:e.clientY};const p=getPoint(e,!['erase','split','extend','offset'].includes(tool));pointer=p;lastPlacement=p;drawClick(e,p);renderDraft();e.preventDefault();return;}
 const h=e.target.closest('[data-node]'),el=e.target.closest('[data-id]');
 const ph=e.target.closest('[data-part]'),pe=e.target.closest('[data-dim-part]');
 if(tool==='select'&&ui.dimensionEditing&&(ph||pe)){const id=ph?.dataset.owner||el?.dataset.id,o=state.objects.find(o=>o.id===id);if(o?.type==='dim')startPartDrag(o,ph?.dataset.part||pe.dataset.dimPart,ph?.dataset.partNode||'move',raw);}
 else if(tool==='move-view'&&(el||selected.size)){if(!selected.size){const owner=el&&state.objects.find(o=>o.id===el.dataset.id);selected=owner?.viewGroup?new Set([owner.id]):new Set(state.objects.filter(visible).map(o=>o.id));}else if(el&&!selected.has(el.dataset.id))selected=new Set([el.dataset.id]);selected=D.withViewGroups(state.objects,selected);ui.activeNode=null;ui.activePart=null;drag={kind:'rigid',start:raw,before:begin(),ids:new Set(selected),delta:pt(0,0)};}
 else if(h?.dataset.node==='rotate'){const id=h.dataset.owner,o=state.objects.find(o=>o.id===id);selected=new Set([id]);ui.activeNode={id,index:'rotate'};drag={kind:'text-rotate',id,before:begin(),original:clone(o),start:raw};}
  else if(h){const id=h.dataset.owner,index=['pos','text'].includes(h.dataset.node)?h.dataset.node:Number(h.dataset.node);selected=new Set([id]);ui.activeNode={id,index};drag={kind:'node',id,index,before:begin(),original:clone(state.objects.find(o=>o.id===id)),start:raw};}
 else if(el&&e.target.closest('[data-dim-text]')){const id=el.dataset.id,o=state.objects.find(o=>o.id===id);selected=new Set([id]);ui.activeNode={id,index:'text'};drag={kind:'text',id,start:raw,before:begin(),original:clone(o)};}
 else if(el){const id=el.dataset.id;if(e.shiftKey){if(selected.has(id))selected.delete(id);else selected.add(id);}else if(!selected.has(id))selected=new Set([id]);ui.activeNode=null;if(selected.has(id)){const o=state.objects.find(o=>o.id===id);if(selected.size===1&&o.type==='dim')drag={kind:'dim-position',id,start:raw,before:begin(),original:clone(o)};else drag={kind:'rigid',start:raw,before:begin(),ids:D.withAttachedDimensions(state.objects,selected),delta:pt(0,0)};}}
 else{const initial=e.shiftKey?new Set(selected):new Set();if(!e.shiftKey)selected.clear();ui.activeNode=null;drag={kind:'marquee',start:raw,end:raw,initial};}
 if(drag)paper.setPointerCapture(e.pointerId);renderSelection();renderInspector();render();e.preventDefault();
});
function restoreDragged(drag){
 // 拖拽过程中只复原被拖动的对象，避免每个 pointermove 都重新解析整份图纸
 const sources=Array.isArray(drag.original)?drag.original:drag.original?[drag.original]:[];
 for(const src of sources){if(!src)continue;const i=state.objects.findIndex(o=>o.id===src.id);if(i>=0)state.objects[i]=clone(src);}
}
let objectsRenderPending=false;
function scheduleObjectsRender(){
 if(objectsRenderPending)return;objectsRenderPending=true;
 requestAnimationFrame(()=>{objectsRenderPending=false;$('#objects-layer').innerHTML=D.drawingOrder(state.objects.filter(o=>visible(o))).map(o=>objectMarkup(o)).join('');renderSelection();});
}
paper.addEventListener('pointermove',e=>{
 if(lastPointerTap&&dist(lastPointerTap.point,pt(e.clientX,e.clientY))>5)lastPointerTap=null;
 if(drag?.kind==='rotation'){updateMouseRotation(e);return;}
 if(drag?.kind==='erase'){const p=getPoint(e,false);pointer=p;eraseSweep(e,p);renderDraft();return;}
 if(drag?.kind==='pan'){pan=add(drag.pan,pt(e.clientX-drag.start.x,e.clientY-drag.start.y));applyZoom();return;}
 if(drag?.kind==='marquee'){drag.end=getPoint(e,false);renderSelection();return;}
 if(drag?.kind==='rigid'){const p=getPoint(e,false);let delta=D.snapMove(sub(p,drag.start),{...state.snaps,step:state.gridStep,bypass:e.altKey});if(e.shiftKey){if(Math.abs(delta.x)>Math.abs(delta.y))delta.y=0;else delta.x=0;}drag.delta=delta;const transform=`translate(${delta.x} ${delta.y})`;for(const entity of $('#objects-layer').children)if(drag.ids.has(entity.dataset.id))entity.setAttribute('transform',transform);$('#selection-layer').setAttribute('transform',transform);pointer=null;renderDraft();return;}
 if(tool==='rect'&&!drag)rectangleCursor={clientX:e.clientX,clientY:e.clientY};
 const p=getPoint(e,drag?.kind==='text'||drag?.kind==='text-rotate'||drag?.kind==='part'||drag?.index==='text'||['erase','split','extend','offset'].includes(tool)?false:tool!=='select'||!!drag);pointer=p;if(hasDraft())lastPlacement=p;
 editHover=!drag?(tool==='erase'?eraseTarget(e,p):tool==='split'?splitTarget(e,p):['extend','offset'].includes(tool)?editingTarget(e,p):null):null;
 measurementHover=!drag&&tool==='dim-distance'?measurementTarget(e,p):null;
 if(drag){restoreDragged(drag);
  if(drag.kind==='text'){const o=state.objects.find(o=>o.id===drag.id);o.textOffset=add(drag.original.textOffset||pt(0,0),sub(p,drag.start));}
   else if(drag.kind==='text-rotate'){const o=state.objects.find(o=>o.id===drag.id),base=D.dimensionLayout(drag.original,{scale:state.scale,font:state.font}).point,rawAngle=Math.atan2(p.y-base.y,p.x-base.x)*180/Math.PI;o.textAngle=round(e.shiftKey?Math.round(rawAngle/15)*15:rawAngle,2);}
  else if(drag.kind==='part'){const o=state.objects.find(o=>o.id===drag.id);editPartDrag(o,drag,p);}
  else if(drag.kind==='dim-position'){const o=state.objects.find(o=>o.id===drag.id);o.pos=add(drag.original.pos,sub(p,drag.start));}
  else if(drag.kind==='node'){const o=state.objects.find(o=>o.id===drag.id);editNode(o,drag.index,p);}
  else {let delta=sub(p,drag.start);if(e.shiftKey){if(Math.abs(delta.x)>Math.abs(delta.y))delta.y=0;else delta.x=0;}const moveIds=new Set(drag.original.map(o=>o.id));for(const o of state.objects)if(moveIds.has(o.id))D.move(o,delta);}
  updateLinked();scheduleObjectsRender();
 }
 renderDraft();
});
function endDrag(e){if(!drag)return;if(drag.kind==='erase'){if(e.type==='pointercancel'){cancelErase();return;}const stroke=drag;drag=null;try{paper.releasePointerCapture(e.pointerId);}catch{}editHover=null;commit(stroke.before);render();if(stroke.count)toast('已擦除 '+stroke.count+' 条边 / 对象，可撤销');return;}if(drag.kind==='rotation'){if(e.type==='pointercancel')cancelMouseRotation();else if(drag.moved)finishMouseRotation();else{drag.armed=true;try{paper.releasePointerCapture(e.pointerId);}catch{}updateMouseRotation(e);}return;}const d=drag;drag=null;try{paper.releasePointerCapture(e.pointerId);}catch{}if(d.kind==='marquee'){selected=d.initial;if(dist(d.start,d.end)>.5){const x1=Math.min(d.start.x,d.end.x),x2=Math.max(d.start.x,d.end.x),y1=Math.min(d.start.y,d.end.y),y2=Math.max(d.start.y,d.end.y);for(const entity of $('#objects-layer').children){const b=entity.getBBox();if(b.x<=x2&&b.x+b.width>=x1&&b.y<=y2&&b.y+b.height>=y1)selected.add(entity.dataset.id);}}}else if(d.kind==='rigid'){D.translateGroup(state.objects,d.ids,d.delta);$('#selection-layer').removeAttribute('transform');commit(d.before);}else if(d.kind!=='pan')commit(d.before);render();}
paper.addEventListener('pointerup',endDrag);paper.addEventListener('pointercancel',endDrag);
paper.addEventListener('keydown',e=>{if(e.target.closest('[data-selection-rotate]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();openRotation();}});
document.addEventListener('pointermove',e=>{if(drag?.kind==='rotation'&&drag.armed&&!paper.contains(e.target))updateMouseRotation(e);});
document.addEventListener('pointerdown',e=>{
 if(drag?.kind!=='rotation'||paper.contains(e.target))return;
 if(drag.armed&&viewport.contains(e.target)&&e.button===0){updateMouseRotation(e);finishMouseRotation();e.preventDefault();e.stopPropagation();}else cancelMouseRotation();
},true);
paper.addEventListener('pointerleave',()=>{rectangleCursor=null;if(!drag){currentSnap=null;measurementHover=null;pointer=null;renderDraft();}});
paper.addEventListener('dblclick',e=>{if(drag?.kind==='rotation'||Date.now()-rotationClickGuard<350||e.target.closest('[data-selection-rotate]'))return;if(numberEditor||$('#selection-dialog').open)return;if(tool==='poly'){finishPoly(false);e.preventDefault();return;}if(tool!=='select'||!selected.size)return;const o=state.objects.find(o=>selected.has(o.id));if(selected.size===1&&o?.type==='dim'){const text=$(`[data-id="${CSS.escape(o.id)}"] > .dimension [data-dim-text]`),b=text?.getBoundingClientRect();if(e.target.closest('[data-dim-text]')||e.target.closest('[data-part="number"]')||(b&&e.clientX>=b.left-5&&e.clientX<=b.right+5&&e.clientY>=b.top-5&&e.clientY<=b.bottom+5)){openNumberEditor(o);return;}}openProperties();});
function openNumberEditor(o){const text=$(`[data-id="${CSS.escape(o.id)}"] > .dimension [data-dim-text]`),b=text.getBoundingClientRect(),form=$('#number-editor');numberEditor={id:o.id,value:o.override!==''&&o.override!=null?String(o.override):fmt(D.dimValue(o,state.scale)),original:o.override??''};$('#number-value').value=numberEditor.value;form.style.left=Math.max(10,Math.min(innerWidth-170,b.left+b.width/2-80))+'px';form.style.top=Math.max(68,Math.min(innerHeight-80,b.top-8))+'px';form.hidden=false;$('#number-value').focus();$('#number-value').select();}
function finishNumberEditor(save=true){
 if(!numberEditor)return true;const edit=numberEditor,value=$('#number-value').value.trim(),o=state.objects.find(o=>o.id===edit.id),next=value===edit.value?edit.original:value;
 if(save&&o&&next!==(o.override??''))mutate(()=>{o.override=next;});numberEditor=null;$('#number-editor').hidden=true;return true;
}
$('#number-editor').addEventListener('submit',e=>{e.preventDefault();finishNumberEditor();});$('#number-editor').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finishNumberEditor(false);}});document.addEventListener('pointerdown',e=>{if(numberEditor&&!e.target.closest('#number-editor'))finishNumberEditor();},true);
paper.addEventListener('contextmenu',e=>{e.preventDefault();if(drag?.kind==='rotation'){cancelMouseRotation();return;}if(tool==='line'){cancelDraft();renderDraft();return;}if(tool==='poly'&&draft.length>1)finishPoly();else if(!stepBack())cancelDraft();});
$('#selection-properties').addEventListener('change',e=>{
 const key=e.target.dataset.prop,o=state.objects.find(o=>selected.has(o.id));if(!key||!o)return;
 if(key==='nodeIndex'){ui.activeNode={id:o.id,index:Number(e.target.value)};renderSelection();renderInspector();return;}
 if(key==='partIndex'){ui.activePart={id:o.id,key:e.target.value};renderSelection();renderInspector();return;}
 if(key.startsWith('batch.')){try{if(e.target.value==='')return;const prop=key.slice(6),value=prop==='textSize'?Number(e.target.value):e.target.value;mutate(()=>{state.objects=E.batchProperties(state.objects,selected,prop,value);});}catch(error){toast(error.message);renderInspector();}return;}
 if(key.startsWith('corner.')){try{mutate(()=>{state.objects=E.resizeCorner(state.objects,o.id,{[key.slice(7)]:Number(e.target.value)});});}catch(error){toast(error.message);renderInspector();}return;}
 const strings=['override','textDirection','style','text','part.style','diameterStyle','radiusStyle','arcLeader','distanceStyle'];let value=['part.hidden','hideText'].includes(key)?!e.target.checked:['autoSymbols','reference','spherical'].includes(key)?e.target.checked:strings.includes(key)?e.target.value:Number(e.target.value);if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>100000)){toast('请输入有效的坐标或尺寸');renderInspector();return;}
 if(['length','r','radius','diameter','size','shapeWidth','shapeHeight'].includes(key)&&value<=0){toast('尺寸必须大于 0');renderInspector();return;}
 if(key==='textSize'&&(value<.5||value>20)){toast('数字字高请设为 0.5–20 mm');renderInspector();return;}
 if(key==='part.scale'&&(value<5||value>2000)){toast('元素大小请设为 5–2000%');renderInspector();return;}
 if(key==='part.width'&&(value<.05||value>2)){toast('线宽请设为 0.05–2 mm');renderInspector();return;}
 if(key==='extension'&&Math.abs(value)>50){toast('界线超出长度请设为 −50–50 mm');renderInspector();return;}
 if(key==='leaderLength'&&e.target.value.trim()===''){mutate(()=>{delete o.leaderLength;});return;}
 if(key==='leaderLength'&&(value<0||value>100)){toast('引线长度请设为 0–100 mm');renderInspector();return;}
 if(key==='sweepAngle'&&(Math.abs(value)<.0000001||Math.abs(value)>=360)){toast('圆心角需大于 0° 且小于 360°，负数表示反向');renderInspector();return;}
 mutate(()=>{
 if(key.startsWith('part.')){if(!ui.activePart||ui.activePart.id!==o.id)return;const edit=o.partEdits?.[ui.activePart.key]||{},prop=key.slice(5);if(prop.startsWith('p1.')||prop.startsWith('p2.')){const part=D.dimensionParts(o,{scale:state.scale,font:state.font}).find(p=>p.id===ui.activePart.key),[point,axis]=prop.split('.'),end=point==='p1'?'start':'end';edit[end]=edit[end]||pt(0,0);edit[end][axis]+=value-part[point][axis];}else if(prop.startsWith('offset.')){edit.offset=edit.offset||pt(0,0);edit.offset[prop.slice(7)]=value;}else edit[prop]=prop==='scale'?value/100:value;o.partEdits={...o.partEdits,[ui.activePart.key]:edit};}
 else if(key==='groupScale'){if(value<=0||value>10000)return;const members=D.withCornerMembers(state.objects,selected),os=state.objects.filter(o=>members.has(o.id)),pts=os.flatMap(D.anchors),origin=pt(Math.min(...pts.map(p=>p.x)),Math.min(...pts.map(p=>p.y)));if(!pts.length)return;for(const obj of os){D.move(obj,mul(origin,-1));D.scaleObject(obj,value/100);D.move(obj,origin);}}
 else if(key==='length'||key==='rotation'){const length=key==='length'?value:dist(o.p1,o.p2),a=key==='rotation'?value*Math.PI/180:Math.atan2(o.p2.y-o.p1.y,o.p2.x-o.p1.x);o.p2=add(o.p1,pt(Math.cos(a)*length,Math.sin(a)*length));}
 else if(key==='distanceStyle'){o.distanceStyle=value;delete o.miter;}
 else if(key==='arcLeader'){if(value==='auto')delete o.arcLeader;else o.arcLeader=value;}
 else if(key==='diameter')o.r=value/2;
 else if(key==='shapeWidth'||key==='shapeHeight'){const axis=key==='shapeWidth'?'x':'y',sign=Math.sign(o.p2[axis]-o.p1[axis])||1;o.p2[axis]=o.p1[axis]+sign*value;}
 else if(key.startsWith('move.'))moveSelection(key.endsWith('x')?pt(value,0):pt(0,value));
 else if(key==='textDirection'){if(value==='auto')delete o.textAngle;else o.textAngle=value==='custom'?(o.textAngle||0):Number(value);}
 else if(key.startsWith('node.')){const idx=ui.activeNode?.id===o.id?ui.activeNode.index:0,p={...editHandles(o)[idx]};p[key.slice(5)]=value;editNode(o,idx,p);}
 else if(key.includes('.')){const [a,b]=key.split('.');if(!o[a])o[a]=pt(0,0);o[a][b]=value;}
 else {o[key]=value;if(key==='style')delete o.width;}
 });
});
$('#selection-properties').addEventListener('click',e=>{const corner=e.target.closest('[data-corner-select]');if(corner){selected=new Set([corner.dataset.cornerSelect]);render();return;}const a=e.target.closest('[data-action]')?.dataset.action;if(a==='detach-corner')mutate(()=>{for(const o of state.objects)if(selected.has(o.id))delete o.corner;});if(a==='rotate')openRotation();if(a==='delete')deleteSelection();if(a==='duplicate')duplicate();if(a==='explode')explodeSelection();if(a==='reset-part'&&ui.activePart)mutate(()=>{const o=state.objects.find(o=>o.id===ui.activePart.id);if(o?.partEdits)delete o.partEdits[ui.activePart.key];});if(a==='reset-parts')mutate(()=>{for(const o of state.objects.filter(o=>selected.has(o.id)&&o.type==='dim')){delete o.partEdits;o.extension=2;delete o.textOffset;delete o.textAngle;delete o.textSize;delete o.hideText;delete o.autoSymbols;}});if(a==='reset-text')mutate(()=>{for(const o of state.objects.filter(o=>selected.has(o.id)&&o.type==='dim')){delete o.textOffset;delete o.textAngle;delete o.textSize;delete o.hideText;delete o.autoSymbols;}});});
$('#selection-properties').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('input[data-prop]')){e.preventDefault();e.target.dispatchEvent(new Event('change',{bubbles:true}));}});
function deleteSelection(){if(!selected.size||mode!=='edit')return;mutate(()=>{const ids=new Set(selected);state.objects=state.objects.filter(o=>!ids.has(o.id));selected.clear();ui.activeNode=null;});}
function explodeSelection(){
 if(!selected.size||mode!=='edit')return;
 const before=begin(),oldObjects=state.objects.slice(),selectedIds=new Set(selected),exploded=new Map(),objects=[],replacements=[];
 for(const o of oldObjects){
  if(!selectedIds.has(o.id)){objects.push(o);continue;}
  const result=D.explodeShape(o);if(!result){objects.push(o);continue;}
  if(o.viewGroup)for(const part of result.objects){part.viewGroup=o.viewGroup;part.projectionRole=o.projectionRole;}
  exploded.set(o.id,result);objects.push(...result.objects);replacements.push(...result.objects);
 }
 if(!replacements.length){toast('所选对象不包含可分解的直线或圆弧');return;}
 const oldById=new Map(oldObjects.map(o=>[o.id,o]));
 const nearestAnchor=(source,index,candidates)=>{const p=source&&D.anchors(source)[index];if(!p)return null;let best=null,min=Infinity;for(const obj of candidates){const local=D.anchors(obj);for(let i=0;i<local.length;i++){const d=dist(p,local[i]);if(d<min){min=d;best={id:obj.id,index:i};}}}return min<.02?best:null;};
 for(const object of objects.filter(o=>o.corner))for(const ref of [object.corner.first,object.corner.second]){const map=exploded.get(ref.id);if(!map)continue;const target=map.objects.find((part,i)=>map.parts[i].index===ref.partIndex);if(target){ref.id=target.id;ref.partIndex=0;}}
 for(const d of objects.filter(o=>o.type==='dim')){
  const sourceMap=d.circleId&&exploded.get(d.circleId);
  if(sourceMap){const target=Number.isInteger(d.circlePart)?sourceMap.objects.find((obj,i)=>sourceMap.parts[i].index===d.circlePart):sourceMap.objects.find(obj=>obj.type==='circle'||obj.type==='arc');if(target){d.circleId=target.id;delete d.circlePart;}}
  for(const key of ['ref1','ref2']){const ref=d[key];if(!ref)continue;const map=exploded.get(ref.id);if(!map)continue;const anchor=nearestAnchor(oldById.get(ref.id),ref.index,map.objects);if(anchor){ref.id=anchor.id;ref.index=anchor.index;}}
  for(const ref of [...D.measurementRefs(d.measurement),...D.intersectionRefs(d)]){const map=exploded.get(ref.id);if(!map)continue;if(Number.isInteger(ref.partIndex)){const target=map.objects.find((obj,i)=>map.parts[i].index===ref.partIndex);if(target){ref.id=target.id;ref.index=0;ref.partIndex=0;}continue;}const anchor=nearestAnchor(oldById.get(ref.id),ref.index,map.objects);if(anchor){ref.id=anchor.id;ref.index=anchor.index;}}
 }
 state.objects=objects;selected=new Set(replacements.map(o=>o.id));ui.activeNode=null;ui.activePart=null;commit(before);toast(`已分解为 ${replacements.length} 个线段 / 圆弧对象`);
}
function copiedObjects(source,delta){
 const copies=clone(source),ids=new Map(copies.map(o=>[o.id,D.id()])),groups=new Map();
 for(const o of copies){
  o.id=ids.get(o.id);
  if(o.viewGroup){if(!groups.has(o.viewGroup))groups.set(o.viewGroup,D.id());o.viewGroup=groups.get(o.viewGroup);}
  for(const k of ['ref1','ref2'])if(o[k]){if(ids.has(o[k].id))o[k].id=ids.get(o[k].id);else delete o[k];}
  if(o.corner){if([o.corner.first,o.corner.second].some(ref=>!ids.has(ref.id)))delete o.corner;else for(const ref of [o.corner.first,o.corner.second])ref.id=ids.get(ref.id);}
  if(o.circleId){if(ids.has(o.circleId))o.circleId=ids.get(o.circleId);else delete o.circleId;}
  for(const holder of [o,o.measurement].filter(Boolean))for(const key of ['intersection1','intersection2','pointIntersection'])if(holder[key]){const spec=holder[key];if([spec.line1,spec.line2].some(r=>!ids.has(r.id)))delete holder[key];else for(const ref of [spec.line1,spec.line2])ref.id=ids.get(ref.id);}
  if(o.measurement){const refs=D.measurementRefs(o.measurement);if(refs.some(r=>!ids.has(r.id)))delete o.measurement;else for(const ref of refs)ref.id=ids.get(ref.id);}
  D.move(o,delta);
 }
 return copies;
}
function duplicate(){if(!selected.size||mode!=='edit')return;const copies=copiedObjects(state.objects.filter(o=>D.withCornerMembers(state.objects,selected).has(o.id)),pt(5,5));mutate(()=>{state.objects.push(...copies);selected=new Set(copies.map(o=>o.id));});}
function clipboardPayload(objects){return JSON.stringify({format:'sanview-clipboard',version:1,objects});}
function parseClipboardPayload(text){
 try{
  const data=JSON.parse(text);
  if(data?.format!=='sanview-clipboard'||!Array.isArray(data.objects)||!data.objects.length)return null;
  const doc=SanviewDoc.validateDoc({version:2,objects:data.objects});
  return doc.objects.length?doc.objects:null;
 }catch{return null;}
}
function copySelection(){
 if(!selected.size||mode!=='edit')return;
 const members=D.withCornerMembers(state.objects,selected),objects=clone(state.objects.filter(o=>members.has(o.id)));
 if(!objects.length)return;
 clipboard=objects;clipboardPastes=0;
 toast(`已复制 ${objects.length} 个对象`);
 const text=clipboardPayload(objects),fallback=()=>{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;left:-9999px;top:0';document.body.appendChild(area);area.select();try{document.execCommand('copy');}catch{}area.remove();};
 try{const pending=navigator.clipboard?.writeText(text);if(pending?.then)pending.then(()=>{},fallback);else fallback();}catch{fallback();}
}
function pasteObjects(objects){
 if(!objects?.length)return;
 if(tool!=='select')setTool('select');
 const offset=10+clipboardPastes*5;clipboardPastes++;
 const copies=copiedObjects(objects,pt(offset,offset));
 mutate(()=>{state.objects.push(...copies);selected=new Set(copies.map(o=>o.id));});
 toast(`已粘贴 ${copies.length} 个对象`);
}
async function pasteClipboard(){
 if(mode!=='edit')return;
 if(clipboard?.length){pasteObjects(clipboard);return;}
 if(!navigator.clipboard?.readText){toast('剪贴板中没有可粘贴的图形');return;}
 try{
  const text=await navigator.clipboard.readText(),objects=parseClipboardPayload(text);
  if(!objects){toast('剪贴板中没有可粘贴的图形');return;}
  clipboard=objects;clipboardPastes=0;pasteObjects(objects);
 }catch{toast('没有可粘贴的图形，或无法读取剪贴板');}
}
function syncControls(){
 $('#project-title').value=state.title;$('#dim-font').value=state.font;const scaleSelect=$('#drawing-scale');scaleSelect.querySelector('[data-model-scale]')?.remove();if(![...scaleSelect.options].some(o=>Number(o.value)===state.scale)){const option=new Option(state.scale<1?'1 : '+fmt(1/state.scale):fmt(state.scale)+' : 1',String(state.scale));option.dataset.modelScale='true';scaleSelect.add(option);}scaleSelect.value=state.scale;$('#dimensions-toggle').checked=state.showDimensions;$('#crosshair-toggle').checked=state.crosshair!==false;$('#grid-step').value=state.gridStep;$('#snap-grid').closest('label').title=fmt(state.gridStep)+' mm 网格吸附';
 for(const k of ['grid','object','intersection','projection']){const box=$('#snap-'+k);box.checked=state.snaps[k];box.disabled=!state.snaps.enabled;}
 $('#snap-tolerance').value=state.snaps.tolerance;$('#snap-tolerance').disabled=!state.snaps.enabled;
 $('#snap-toggle').classList.toggle('on',state.snaps.enabled);$('#snap-toggle').setAttribute('aria-pressed',String(state.snaps.enabled));$('#snap-toggle').title=state.snaps.enabled?'关闭全部吸附 · Alt 临时暂停':'开启吸附';$('#snap-toggle-label').textContent=state.snaps.enabled?'吸附':'自由';
 $('#grid-toggle').classList.toggle('on',state.grid);$('#grid-toggle').setAttribute('aria-pressed',String(state.grid));$('#grid-toggle').title=state.grid?'隐藏网格':'显示网格';
}
$$('[data-tool]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tool===tool)showToolOptions(tool);else setTool(b.dataset.tool);}));
function showToolOptions(next){
 const drawing=['line','poly','rect','circle','arc'].includes(next),lineGroup=['line','poly'].includes(next),shapeGroup=['rect','circle'].includes(next),diameter=next==='dim-diameter',radius=next==='dim-radius',arcDim=['dim-arc','dim-chord'].includes(next),distance=next==='dim-distance',fillet=['fillet','chamfer'].includes(next),editing=['erase','split','extend','offset'].includes(next),popup=$('#tool-options');popup.hidden=!drawing&&!diameter&&!radius&&!arcDim&&!distance&&!fillet&&!editing;
 $('#edit-tool').setAttribute('aria-expanded',String(!popup.hidden&&editing));$('#edit-options').hidden=!editing;$('#offset-distance-label').hidden=next!=='offset';$('#offset-distance').value=offsetDistance;$$('[data-edit-type]').forEach(b=>{b.classList.toggle('active',b.dataset.editType===next);b.setAttribute('aria-pressed',String(b.dataset.editType===next));});
 $('#line-tool').setAttribute('aria-expanded',String(!popup.hidden&&lineGroup));$('#shape-tool').setAttribute('aria-expanded',String(!popup.hidden&&shapeGroup));
 $('#arc-tool').setAttribute('aria-expanded',String(!popup.hidden&&next==='arc'));
 $('#corner-tool').setAttribute('aria-expanded',String(!popup.hidden&&fillet));
 if(popup.hidden)return;
 if(distance)syncDistanceOptions();
 $('#line-type-options').hidden=!lineGroup;$('#shape-type-options').hidden=!shapeGroup;
 $$('[data-line-type]').forEach(b=>{const active=next===b.dataset.lineType;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $$('[data-shape-type]').forEach(b=>{const active=next===b.dataset.shapeType;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $('#profile-options').hidden=next!=='rect';$('#arc-options').hidden=next!=='arc';$('#distance-options').hidden=!distance;$('#arc-dim-options').hidden=!arcDim;$('#arc-leader-choices').hidden=next!=='dim-arc';$('#chord-note').hidden=next!=='dim-chord';$('#fillet-options').hidden=!fillet;$('#fillet-radius').value=filletRadius;$('#fillet-radius-label').hidden=next!=='fillet';$('#chamfer-fields').hidden=next!=='chamfer';$('#chamfer-distance-1').value=chamferDistance1;$('#chamfer-distance-2').value=chamferDistance2;$$('[data-corner-tool]').forEach(b=>{const active=b.dataset.cornerTool===next;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('#diameter-options').hidden=!diameter;$('#radius-options').hidden=!radius;$('#style-options').hidden=!drawing;$('#arc-sweep').value=arcSweep;$('#arc-direction').value=arcDirection;
 const button=$(`[data-tool="${next}"]`);if(!button){popup.hidden=true;return;}const b=button.getBoundingClientRect();popup.style.left=Math.min(b.right+12,innerWidth-popup.offsetWidth-12)+'px';
 $$('[data-distance-style]').forEach(b=>{b.classList.toggle('active',b.dataset.distanceStyle===distanceStyle);b.setAttribute('aria-pressed',String(b.dataset.distanceStyle===distanceStyle));});$$('[data-style]').forEach(b=>{b.hidden=b.dataset.style==='center'&&next!=='line';b.classList.toggle('active',b.dataset.style===style);b.setAttribute('aria-pressed',String(b.dataset.style===style));});
 $$('[data-profile]').forEach(b=>{b.classList.toggle('active',b.dataset.profile===profileKind);b.setAttribute('aria-pressed',String(b.dataset.profile===profileKind));});
 $$('[data-arc-mode],[data-arc-angle]').forEach(b=>{const active=b.dataset.arcMode===arcMode||(arcMode==='fixed'&&Number(b.dataset.arcAngle)===arcSweep);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $$('[data-diameter-style]').forEach(b=>{const active=b.dataset.diameterStyle===diameterStyle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $$('[data-radius-style]').forEach(b=>{const active=b.dataset.radiusStyle===radiusStyle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $$('[data-arc-leader]').forEach(b=>{const active=b.dataset.arcLeader===arcLeader;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 const top=$('.app-header').getBoundingClientRect().bottom+12,bottom=$('.status-bar').getBoundingClientRect().top-12;popup.style.maxHeight=Math.max(100,bottom-top)+'px';popup.style.top=Math.max(top,Math.min(bottom-popup.offsetHeight,b.top))+'px';
}
$('#tool-options').addEventListener('click',e=>{if(setDistanceOption(e))return;const corner=e.target.closest('[data-corner-tool]');if(corner){setTool(corner.dataset.cornerTool);return;}const edit=e.target.closest('[data-edit-type]'),mirror=e.target.closest('[data-mirror-axis]');if(edit){setTool(edit.dataset.editType);return;}if(mirror){mirrorSelection(mirror.dataset.mirrorAxis);return;}const lineType=e.target.closest('[data-line-type]'),shapeType=e.target.closest('[data-shape-type]'),line=e.target.closest('[data-style]'),profile=e.target.closest('[data-profile]'),arc=e.target.closest('[data-arc-mode],[data-arc-angle]'),diameter=e.target.closest('[data-diameter-style]'),radius=e.target.closest('[data-radius-style]'),arcLeaderButton=e.target.closest('[data-arc-leader]'),styleButton=e.target.closest('[data-distance-style]');if(lineType){const next=lineType.dataset.lineType;if(next!==tool)setTool(next);return;}if(shapeType){const next=shapeType.dataset.shapeType;if(next!==tool)setTool(next);return;}if(styleButton){distanceStyle=styleButton.dataset.distanceStyle;showToolOptions('dim-distance');$('#tool-status').textContent=distanceStyles[distanceStyle]+' · 选择测量对象后点击放置';renderDraft();return;}if(line){style=line.dataset.style;$('#tool-options').hidden=true;}if(profile){profileKind=profile.dataset.profile;showToolOptions('rect');$('#tool-status').textContent=profileNames[profileKind]+' · 点击两个对角点 · 按住 Shift 等宽高';}if(arc){cancelDraft();arcMode=arc.dataset.arcMode||'fixed';if(arc.dataset.arcAngle)arcSweep=Number(arc.dataset.arcAngle);showToolOptions('arc');$('#tool-status').textContent=arcHint();}if(diameter){diameterStyle=diameter.dataset.diameterStyle;$('#tool-options').hidden=true;$('#tool-status').textContent=diameterStyles[diameterStyle]+' · 点击放置直径尺寸';renderDraft();}if(radius){radiusStyle=radius.dataset.radiusStyle;$('#tool-options').hidden=true;$('#tool-status').textContent=radiusStyles[radiusStyle]+' · 点击放置半径尺寸';renderDraft();}if(arcLeaderButton){arcLeader=arcLeaderButton.dataset.arcLeader;showToolOptions(tool);$('#tool-status').textContent=(arcLeader==='auto'?'自动':arcLeader==='perpendicular'?'平行弦的垂直平分线':'沿径向')+' · 点击放置弧长尺寸';renderDraft();}});
for(const event of ['click','change'])$('#tool-options').addEventListener(event,rememberTools);
$('#close-tool-options').addEventListener('click',()=>$('#tool-options').hidden=true);
$('.distance-measure-settings').addEventListener('toggle',()=>{if(tool==='dim-distance'&&!$('#tool-options').hidden)showToolOptions(tool);});
for(const selector of ['#fillet-radius','#chamfer-distance-1','#chamfer-distance-2'])$(selector).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.dispatchEvent(new Event('change',{bubbles:true}));}});
$('#distance-repeat').addEventListener('change',e=>{distanceRepeat=e.target.value;if(distanceRepeat!=='single'&&distancePickMode!=='points'){cancelDraft();distancePickMode='points';}syncDistanceOptions();$('#tool-status').textContent=distanceRepeat==='single'?dimensionHint():distanceRepeat==='chain'?'连续标注 · 两点取距，完成后自动续上一点':'基线标注 · 两点取距，完成后保留首点';});
$('#distance-intersections').addEventListener('change',e=>{distanceIntersections=e.target.checked;measurementHover=null;renderDraft();});
for(const [selector,which] of [['#chamfer-distance-1',1],['#chamfer-distance-2',2]])$(selector).addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<.05||value>10000){e.target.value=which===1?chamferDistance1:chamferDistance2;toast('倒角距离请设为 0.05–10000 mm');return;}if(which===1)chamferDistance1=value;else chamferDistance2=value;renderDraft();});
$('#offset-distance').addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<.05||value>10000){e.target.value=offsetDistance;toast('偏移距离请设为 0.05–10000 mm');return;}offsetDistance=value;renderDraft();});
$('#arc-sweep').addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<.1||value>359.9){e.target.value=arcSweep;toast('圆心角请设为 0.1–359.9°');return;}cancelDraft();arcSweep=value;arcMode='fixed';showToolOptions('arc');$('#tool-status').textContent=arcHint();});
$('#arc-sweep').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.dispatchEvent(new Event('change'));e.target.blur();}});
$('#arc-direction').addEventListener('change',e=>{arcDirection=e.target.value;renderDraft();$('#tool-status').textContent=arcHint();});
const reference=$('#dimension-reference');
document.addEventListener('pointerdown',e=>{if(!reference.contains(e.target))reference.open=false;});
reference.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();reference.open=false;reference.querySelector('summary').focus();}});
$('#selection-btn').addEventListener('click',()=>{if(selected.size){$('#tool-options').hidden=true;openProperties();}});
$('#dimension-edit-toggle').addEventListener('click',()=>{ui.dimensionEditing=!ui.dimensionEditing;ui.activePart=null;setTool('select');$('#dimension-edit-toggle').setAttribute('aria-pressed',String(ui.dimensionEditing));$('#dimension-edit-toggle').classList.toggle('on',ui.dimensionEditing);if(ui.dimensionEditing)$('#tool-status').textContent='尺寸编辑 · 拖动元素，端点可单独调整';render();});
for(const k of ['grid','object','intersection','projection'])$('#snap-'+k).addEventListener('change',e=>{currentSnap=null;measurementHover=null;mutate(()=>state.snaps[k]=e.target.checked);syncControls();});
$('#snap-tolerance').addEventListener('change',e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||value<3||value>12){toast('吸附范围请设为 3–12 px');syncControls();return;}currentSnap=null;measurementHover=null;mutate(()=>state.snaps.tolerance=round(value,1));syncControls();});
$('#snap-toggle').addEventListener('click',()=>{currentSnap=null;measurementHover=null;mutate(()=>state.snaps.enabled=!state.snaps.enabled);syncControls();});
$('#crosshair-toggle').addEventListener('change',e=>{mutate(()=>{state.crosshair=e.target.checked;});renderDraft();});
$('#dimensions-toggle').addEventListener('change',e=>mutate(()=>{state.showDimensions=e.target.checked;if(!state.showDimensions)for(const o of state.objects)if(o.type==='dim')selected.delete(o.id);}));
$('#dim-font').addEventListener('change',e=>{const size=Number(e.target.value);if(!Number.isFinite(size)||size<.5||size>20){toast('字高请设为 0.5–20 mm');syncControls();return;}mutate(()=>{state.font=size;for(const o of state.objects)if(o.type==='dim')delete o.textSize;});});$('#drawing-scale').addEventListener('change',e=>mutate(()=>state.scale=Number(e.target.value)));
$('#grid-step').addEventListener('change',e=>{const step=Number(e.target.value);if(!Number.isFinite(step)||step<.1||step>50){toast('网格尺寸请设为 0.1–50 mm');syncControls();return;}cancelDraft();mutate(()=>state.gridStep=round(step,2));syncControls();});for(const id of ['grid-step','dim-font','snap-tolerance'])$('#'+id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.target.dispatchEvent(new Event('change',{bubbles:true}));e.target.blur();}});
$('#project-title').addEventListener('change',e=>mutate(()=>state.title=e.target.value.slice(0,100)||'三视图尺寸标注练习'));
function toggleGrid(){mutate(()=>state.grid=!state.grid);syncControls();}
$('#grid-toggle').addEventListener('click',toggleGrid);$('#undo-btn').addEventListener('click',()=>history());$('#redo-btn').addEventListener('click',()=>history(true));
function fit(){if(drag?.kind==='rotation')cancelMouseRotation();const b=viewport.getBoundingClientRect(),mobile=innerWidth<=700,pad=mobile?24:innerWidth>=1600?100:50;const css=getComputedStyle(viewport),verticalPadding=parseFloat(css.paddingTop)+parseFloat(css.paddingBottom);const availableW=b.width-pad,availableH=b.height-Math.max(verticalPadding+10,mobile?88:70);baseWidth=Math.max(100,Math.min(availableW,availableH*297/210,1040));shell.style.width=baseWidth+'px';zoom=1;pan=pt(0,0);applyZoom();}
// Size the SVG viewport at the displayed resolution. Scaling a cached CSS
// layer magnifies its old pixels instead of repainting the vector drawing.
function applyZoom(){shell.style.width=baseWidth*zoom+'px';shell.style.transform=`translate(${pan.x}px,${pan.y}px)`;$('#zoom-value').textContent=Math.round(zoom*100)+'%';renderSelection();}
function changeZoom(factor){if(drag?.kind==='rotation')cancelMouseRotation();zoom=Math.max(.3,Math.min(4,zoom*factor));applyZoom();}
$('#zoom-in').addEventListener('click',()=>changeZoom(1.15));$('#zoom-out').addEventListener('click',()=>changeZoom(1/1.15));$('#zoom-value').addEventListener('click',fit);$('#fit-btn').addEventListener('click',fit);viewport.addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY<0?1.08:1/1.08);},{passive:false});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(fit,100);});
// A sidebar changes the viewport without a window resize. Observe the final
// layout size so the sheet also refits after CSS transitions and on mobile.
if(typeof ResizeObserver!=='undefined'){const viewportResize=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(fit,60);});viewportResize.observe(viewport);}
$('#text-form').addEventListener('submit',e=>{e.preventDefault();const text=$('#text-value').value.trim();if(!text)return;mutate(()=>state.objects.push(D.shape('text',{p:textPos,text,size:3.5},activeLayer)));$('#text-dialog').close();});$('#text-cancel').addEventListener('click',()=>$('#text-dialog').close());
function newDrawing(){projectManager.run(async()=>{await projectManager.start({...clone(state),objects:[],title:'未命名图纸',scale:1,showDimensions:true});setTool('select');toast('已新建独立工程，原图保留在最近工程中');});}
$('#new-btn').addEventListener('click',newDrawing);
const templateInfo={step:{name:'阶梯形构件',desc:'台阶结构 · 尺寸标注基础',svg:D.stepPreview(),params:[['L','总长',70,35,95],['W','总宽',40,20,60],['H','总高',45,25,55],['sl','高台长度',28,10,70],['sh','低台高度',20,8,45]]},slot:{name:'U 形支架',desc:'对称结构 · 厚度与槽宽',svg:'<path d="m25 19 14-8 12 5v37l25 10V27l14-8 14 6v48L79 87 25 65V19Z"/><path d="m25 19 14 6v37l40 16 25-14M39 25l12-9m25 11 14 6 14-8M79 78v9m11-54v37M39 62l12-9"/>',params:[['L','总长',70,40,95],['W','总宽',40,20,60],['H','总高',45,30,55],['T','壁厚',12,5,20]]},hole:{name:'通孔长方体',desc:'圆孔结构 · 直径与定位',svg:'<path d="m27 20 28-15 52 21v47L79 89 27 67V20Z"/><path d="m27 20 52 21 28-15M79 41v48"/><ellipse cx="53" cy="52" rx="11" ry="15" transform="rotate(-18 53 52)"/>',params:[['L','总长',70,40,95],['W','总宽',40,20,60],['H','总高',45,30,55],['R','孔半径',8,3,18]]}};
const templateValues={};
function rememberTemplateParams(){if(!$('#template-params').children.length)return;templateValues[templateKind]=Object.fromEntries(templateInfo[templateKind].params.map(([key])=>[key,$('#param-'+key).value]));}
function readTemplateParams(){
 const params={};for(const [key,label,,min,max] of templateInfo[templateKind].params){const field=$('#param-'+key),n=Number(field.value);if(!field.value.trim()||!Number.isFinite(n)||n<min||n>max)throw Error(label+'需在 '+min+'–'+max+' mm 之间');params[key]=n;}
 if(templateKind==='step')D.stepGeometry(params);return params;
}
function updateTemplatePreview(){
 const note=$('#template-model-note');note.hidden=templateKind!=='step';if(templateKind!=='step')return;
 try{const params=readTemplateParams();$('[data-template="step"] svg').innerHTML=D.stepPreview(params);note.classList.remove('invalid');note.textContent='高台在左，低台在右并贯通全宽。示意图随参数更新，与生成图纸使用同一阶梯截面。';}
 catch(error){note.classList.add('invalid');note.textContent=error.message;}
}
function renderTemplates(){
 const info=templateInfo[templateKind];$('#template-cards').innerHTML=Object.entries(templateInfo).map(([k,i])=>`<button class="template-card ${k===templateKind?'active':''}" data-template="${k}" aria-pressed="${k===templateKind}"><svg viewBox="0 0 130 96" aria-hidden="true">${i.svg}</svg><b>${i.name}</b></button>`).join('');
 $('#template-params').innerHTML=info.params.map(([key,label,n,min,max])=>`<label>${label} <span class="muted">${key}</span><input type="number" id="param-${key}" value="${esc(templateValues[templateKind]?.[key]??n)}" min="${min}" max="${max}" step="1"></label>`).join('');updateTemplatePreview();
}
$('#template-btn').addEventListener('click',()=>{renderTemplates();$('#template-dialog').showModal();});
$('#template-cards').addEventListener('click',e=>{const button=e.target.closest('[data-template]');if(button&&button.dataset.template!==templateKind){rememberTemplateParams();templateKind=button.dataset.template;renderTemplates();}});
$('#template-params').addEventListener('input',()=>{rememberTemplateParams();updateTemplatePreview();});
$('#random-params').addEventListener('click',()=>{for(const [k,,n,min,max] of templateInfo[templateKind].params){const value=k==='L'?50+Math.floor(Math.random()*7)*5:k==='H'?30+Math.floor(Math.random()*5)*5:k==='W'?25+Math.floor(Math.random()*5)*5:k==='sl'?20+Math.floor(Math.random()*3)*5:k==='sh'?10+Math.floor(Math.random()*3)*5:k==='T'?8+Math.floor(Math.random()*5):5+Math.floor(Math.random()*6);$('#param-'+k).value=Math.min(max,Math.max(min,value));}if(Number($('#param-H').value)+Number($('#param-W').value)>92)$('#param-W').value=90-Number($('#param-H').value);rememberTemplateParams();updateTemplatePreview();});
async function generateTemplate(insert=false){let params;try{params=readTemplateParams();}catch(error){toast(error.message);updateTemplatePreview();return;}if(templateKind==='slot'&&(2*params.T>=params.L||params.T>=params.H)){toast('壁厚需小于总长的一半且小于总高');return;}if(templateKind==='hole'&&2*params.R>=Math.min(params.L,params.H)){toast('孔径需小于总长和总高');return;}
 if(params.H+params.W>92){toast('为保持 A4 图纸留白，总高与总宽之和请不超过 92 mm');return;}
 const objects=D.prepareDrawing(D.makePreset(templateKind,params));cancelDraft();
 if(insert){mutate(()=>{state.objects.push(...objects);selected=new Set(objects.map(o=>o.id));});toast('模板已插入当前图纸，可撤销');}
 else{await projectManager.start({...clone(state),objects,scale:1,title:templateInfo[templateKind].name+'的尺寸标注',showDimensions:true});toast('模板已创建为新工程，原图保留在最近工程中');}
 $('#template-dialog').close();setTool('select');syncControls();fit();
}
$('#generate-btn').addEventListener('click',()=>projectManager.run(()=>generateTemplate(false)));
$('#template-insert-btn').addEventListener('click',()=>projectManager.run(()=>generateTemplate(true)));
function makeExport(){updateLinked();return `<svg xmlns="${D.NS}" width="297mm" height="210mm" viewBox="0 0 297 210" style="stroke:none;stroke-width:0;fill:none"><title>${esc(state.title)}</title><desc>三视图工坊 · 完整图纸 · 单位 mm</desc><rect width="297" height="210" fill="white"/><g color="#17241d">${D.drawingOrder(state.objects.filter(o=>visible(o))).map(o=>objectMarkup(o,false)).join('')}</g></svg>`;}
function exportProject(){updateLinked();SanviewDoc.exportProject(state,()=>toast('可编辑工程已下载'));}
$('#copy-btn').addEventListener('click',copySelection);$('#paste-btn').addEventListener('click',pasteClipboard);$('#save-btn').addEventListener('click',exportProject);$('#export-project').addEventListener('click',exportProject);$('#export-btn').addEventListener('click',()=>{$('#export-dialog').showModal();});
$('#export-svg').addEventListener('click',()=>{SanviewDoc.download(new Blob([makeExport()],{type:'image/svg+xml;charset=utf-8'}),SanviewDoc.filename(state,'svg'));toast('SVG 矢量图已下载');});
$('#export-png').addEventListener('click',async()=>{const b=$('#export-png');b.disabled=true;try{const svg=makeExport(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=3508;canvas.height=2480;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob)throw Error('PNG 生成失败');SanviewDoc.download(blob,SanviewDoc.filename(state,'png'));toast('300 dpi 高清图片已下载');}catch{toast('图片生成失败，请先导出 SVG 或使用打印');}finally{b.disabled=false;}});
$('#export-print').addEventListener('click',()=>{$('#print-root').innerHTML=makeExport();$('#export-dialog').close();setTimeout(()=>window.print(),80);});
// 按扩展名分发导入：SVG 直接解析；DXF 先转为等价 SVG 再走同一管线；DWG / DXB 给出明确指引
function importDrawing(name,text){
 if(/.dwg$/i.test(name))throw Error('DWG 是 AutoCAD 私有格式，网页无法可靠读取。请在 CAD 中另存为 DXF 后再导入（也可用 ODA File Converter 转换）');
 if(/.dxb$/i.test(name)||DxfImport.isBinaryDxf(text))throw Error('暂不支持二进制 DXB，请在 CAD 中另存为 DXF 后再导入');
 if(/.dxf$/i.test(name)){const dxf=DxfImport.convert(text);const result=SvgImport.parseSvg(dxf.svg);result.skipped=(result.skipped||0)+dxf.skipped;return result;}
 return SvgImport.parseSvg(text);
}
$('#import-btn').addEventListener('click',()=>{$('#file-input').value='';$('#file-input').click();});
$('#import-btn').title='导入 SVG / DXF、工程，或 STL / OBJ 三维模型';
let modelWorker=null,modelLocal=null,modelResult=null,modelSequence=0,modelEpoch=0,modelPreviewSequence=0,modelInfo=null,modelPreviewTimer;
const modelRequests=new Map();
function clearModelWorker(){if(modelWorker)modelWorker.terminate();modelWorker=null;modelLocal=null;for(const request of modelRequests.values())request.reject(Error('已取消'));modelRequests.clear();}
function modelRequest(action,args={}){
 if(location.protocol==='file:'||typeof Worker==='undefined'){return new Promise((resolve,reject)=>setTimeout(()=>{try{if(action==='load'){modelLocal=M.parse(args.data,args.name);resolve({info:{name:modelLocal.name,format:modelLocal.format,faces:modelLocal.triangles.length,warnings:modelLocal.warnings}});}else resolve({result:M.generate(modelLocal,args.options)});}catch(error){reject(error);}},20));}
 if(!modelWorker){modelWorker=new Worker('model-worker.js?v=19');modelWorker.onmessage=e=>{const pending=modelRequests.get(e.data.id);if(!pending)return;modelRequests.delete(e.data.id);if(e.data.error)pending.reject(Error(e.data.error));else pending.resolve(e.data);};modelWorker.onerror=()=>{for(const request of modelRequests.values())request.reject(Error('模型处理程序无法加载，请刷新页面后重试'));modelRequests.clear();modelWorker?.terminate();modelWorker=null;};}
 return new Promise((resolve,reject)=>{const id=++modelSequence;modelRequests.set(id,{resolve,reject});modelWorker.postMessage({id,action,...args});});
}
function modelDirections(){const current=$('#model3d-front').value,up=$('#model3d-up').value,values=(up==='z'?['-y','y','x','-x']:['z','-z','x','-x']);$('#model3d-front').innerHTML=values.map(value=>`<option value="${value}">从 ${value.startsWith('-')?'−':'+'}${value.at(-1).toUpperCase()} 方向看</option>`).join('');$('#model3d-front').value=values.includes(current)?current:values[0];}
async function openModelFile(file){
 if(!/\.(stl|obj)$/i.test(file.name)){toast('目前支持 STL、OBJ 模型；STEP / STP 请先在建模软件中导出为 STL');return;}if(file.size>20*1024*1024){toast('3D 模型请控制在 20 MB 以内');return;}
 clearModelWorker();clearTimeout(modelPreviewTimer);const epoch=++modelEpoch;modelResult=null;modelInfo=null;$('#model3d-preview').innerHTML='';$('#model3d-file').textContent=file.name;$('#model3d-status').textContent='';$('#model3d-status').classList.remove('error');$('#model3d-busy').textContent='正在读取模型…';$('#model3d-busy').hidden=false;$('#model3d-options').disabled=true;$('#model3d-generate').disabled=true;
 $('#model3d-up').value=/\.obj$/i.test(file.name)?'y':'z';$('#model3d-units').value='1';$('#model3d-scale').value='auto';$('#model3d-hidden').checked=true;modelDirections();if(!$('#model3d-dialog').open)$('#model3d-dialog').showModal();
 try{const data=await file.arrayBuffer();if(epoch!==modelEpoch)return;const response=await modelRequest('load',{data,name:file.name});if(epoch!==modelEpoch)return;modelInfo=response.info;$('#model3d-file').textContent=`${modelInfo.name} · ${modelInfo.format} · ${modelInfo.faces.toLocaleString()} 个三角面`;$('#model3d-options').disabled=false;await previewModel();}catch(error){if(epoch!==modelEpoch)return;$('#model3d-busy').hidden=true;$('#model3d-status').textContent=error.message||'无法读取模型';$('#model3d-status').classList.add('error');}
}
async function previewModel(){
 if(!modelInfo)return;const epoch=modelEpoch,sequence=++modelPreviewSequence;modelResult=null;$('#model3d-generate').disabled=true;$('#model3d-busy').textContent='正在计算投影与隐藏线…';$('#model3d-busy').hidden=false;$('#model3d-status').classList.remove('error');
 const options={units:Number($('#model3d-units').value),up:$('#model3d-up').value,front:$('#model3d-front').value,scale:$('#model3d-scale').value,hidden:$('#model3d-hidden').checked};
 try{const {result}=await modelRequest('generate',{options});if(epoch!==modelEpoch||sequence!==modelPreviewSequence)return;modelResult=result;const {objects}=M.drawing(result);$('#model3d-preview').innerHTML=objects.map(o=>D.renderShape(o)).join('');$('#model3d-busy').hidden=true;const ratio=result.scale<1?'1 : '+fmt(1/result.scale):fmt(result.scale)+' : 1';$('#model3d-status').textContent=`长 × 宽 × 高 ${result.size.map(fmt).join(' × ')} mm · ${ratio}${result.warnings.length?'\n'+result.warnings.join('；'):''}`;$('#model3d-generate').disabled=false;}catch(error){if(epoch!==modelEpoch||sequence!==modelPreviewSequence)return;$('#model3d-preview').innerHTML='';$('#model3d-busy').hidden=true;$('#model3d-status').textContent=error.message||'投影生成失败';$('#model3d-status').classList.add('error');}
}
$('#model3d-options').addEventListener('change',e=>{if(e.target.id==='model3d-up')modelDirections();clearTimeout(modelPreviewTimer);modelPreviewSequence++;modelResult=null;$('#model3d-generate').disabled=true;modelPreviewTimer=setTimeout(previewModel,150);});
$('#model3d-dialog').addEventListener('close',()=>{modelEpoch++;modelPreviewSequence++;clearTimeout(modelPreviewTimer);clearModelWorker();modelResult=null;modelInfo=null;});
$('#model3d-generate').addEventListener('click',()=>{if(!modelResult)return;const result=modelResult,drawing=M.drawing(result,D.id);cancelDraft();mutate(()=>{const enabled=state.inspection.enabled;state.objects=D.prepareDrawing(drawing.objects);state.scale=result.scale;state.title=result.name.replace(/\.(stl|obj)$/i,'').slice(0,100)||'模型三视图';state.showDimensions=true;state.inspection=I.validateOptions({enabled,depthConfirmed:true},state.objects);selected.clear();});$('#model3d-dialog').close();setTool('select');syncControls();fit();toast('已生成三视图与轴测图，可标注、编辑；按 M 可整体移动各图');});
$('#file-input').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;if(/\.(stl|obj|step|stp)$/i.test(file.name)){openModelFile(file);return;}if(file.size>10*1024*1024){toast('文件过大，请选择 10 MB 以内的 SVG、DXF 或工程');return;}try{const text=await file.text();cancelDraft();if(/\.(json|sanview)$/i.test(file.name)){const loaded=SanviewDoc.validateDoc(JSON.parse(text));await projectManager.start(loaded);setTool('select');syncControls();fit();toast('工程已打开，原图保留在最近工程中');}else{const result=importDrawing(file.name,text);mutate(()=>{state.objects.push(...D.prepareDrawing(result.objects));selected=new Set(result.objects.map(o=>o.id));});setTool('select');toast(`已导入 ${result.objects.length} 个可编辑对象${result.fitScale<1?'，已按 '+Math.round(result.fitScale*100)+'% 缩放适配图纸':''}${result.skipped?'；部分非几何内容已略过':''}`);if(result.fitScale<1)toast('导入图已缩放至 '+Math.round(result.fitScale*100)+'%；请在标注前校准图形尺寸与绘图比例');}}catch(err){toast(err.message||'无法导入此文件');}});
window.addEventListener('keydown',e=>{if(drag?.kind==='erase'){if(e.key==='Escape'){e.preventDefault();cancelErase();}return;}if(drag?.kind==='rotation'){if(e.key==='Escape'){e.preventDefault();cancelMouseRotation();}else if(e.key==='Enter'){e.preventDefault();finishMouseRotation();}else if(e.key==='Shift'){updateMouseRotation({clientX:drag.client.x,clientY:drag.client.y,shiftKey:true});}else e.preventDefault();return;}if(e.key==='Enter'&&e.target.closest('button:not([data-tool]),summary,a'))return;const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName),modal=!!document.querySelector('dialog[open]:not(#selection-dialog)');if(modal)return;if(typing){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();finishNumberEditor();e.target.blur();exportProject();}return;}
 const key=e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey;
 if(ctrl){if(key==='z'){e.preventDefault();if(e.shiftKey||!stepBack())history(e.shiftKey);}else if(key==='y'){e.preventDefault();history(true);}else if(key==='c'){e.preventDefault();copySelection();}else if(key==='v'){if(clipboard?.length){e.preventDefault();clipboardPasteGuard=Date.now();pasteObjects(clipboard);}}else if(key==='s'){e.preventDefault();exportProject();}else if(key==='d'){e.preventDefault();duplicate();}else if(key==='a'&&mode==='edit'){e.preventDefault();selected=new Set(state.objects.filter(o=>visible(o)).map(o=>o.id));render();}return;}
 if(e.shiftKey&&key==='r'){e.preventDefault();openRotation();return;}
 if(key==='tab'&&['dim-radius','dim-diameter'].includes(tool)&&draftRefs.length){e.preventDefault();const radius=tool==='dim-radius',styles=Object.keys(radius?radiusStyles:diameterStyles),current=radius?radiusStyle:diameterStyle,next=styles[(styles.indexOf(current)+1)%styles.length];if(radius)radiusStyle=next;else diameterStyle=next;rememberTools();$('#tool-status').textContent=(radius?radiusStyles[next]:diameterStyles[next])+' · 点击放置';if(!$('#tool-options').hidden)showToolOptions(tool);renderDraft();return;}
 if(key==='tab'&&tool==='dim-arc'){e.preventDefault();arcLeader=arcLeader==='auto'?'perpendicular':arcLeader==='perpendicular'?'radial':'auto';rememberTools();$('#tool-status').textContent=`尺寸界线：${{auto:'自动',perpendicular:'平行弦的垂直平分线',radial:'沿径向'}[arcLeader]} · 点击放置`;renderDraft();return;}
 if(key==='tab'&&tool==='dim-distance'&&(distancePickMode==='auto'||S.distanceStep(distancePickMode,measureTargets).pick==='place')&&(measureTargets.length===1&&measureTargets[0].type==='line'||measureTargets.length===2&&measureTargets.every(t=>t.type==='point'))){e.preventDefault();const current=distanceData(pointer||draft.at(-1)).kind,kinds=['horizontal','vertical','aligned'];distanceDirection=kinds[(kinds.indexOf(current)+1)%kinds.length];distanceDefaultDirection=distanceDirection;rememberTools();syncDistanceOptions();$('#tool-status').textContent=`方向：${{horizontal:'水平距离',vertical:'垂直距离',aligned:'直线距离'}[distanceDirection]} · 移动并点击放置`;renderDraft();return;}
 if(key==='tab'&&tool==='arc'&&arcMode!=='three'&&draft.length){e.preventDefault();arcDirection=arcDirection==='auto'?'cw':arcDirection==='cw'?'ccw':'auto';$('#arc-direction').value=arcDirection;rememberTools();renderDraft();$('#tool-status').textContent=arcHint();return;}
 if(key==='escape'){e.preventDefault();if(stepBack())return;if($('#selection-dialog').open){$('#selection-dialog').close();return;}selected.clear();ui.activeNode=null;setTool('select');}
 else if(key==='enter'&&hasDraft()){e.preventDefault();finishCurrent();}else if(key==='delete'||key==='backspace'){e.preventDefault();deleteSelection();}else if(key===' '){e.preventDefault();space=true;paper.style.cursor='grab';}else if(['arrowup','arrowdown','arrowleft','arrowright'].includes(key)&&selected.size&&mode==='edit'){e.preventDefault();const step=e.shiftKey?5:1,v=pt(key==='arrowleft'?-step:key==='arrowright'?step:0,key==='arrowup'?-step:key==='arrowdown'?step:0);mutate(()=>moveSelection(v));}else {const keys={h:'pan',x:'erase',s:'split',e:'extend',o:'offset',v:'select',m:'move-view',l:'line',p:'poly',b:'rect',c:'circle',a:'arc',t:'text',f:e.shiftKey?'chamfer':'fillet',r:'dim-radius',g:'dim-angle',q:'dim-arc',w:'dim-chord',d:e.shiftKey?'dim-diameter':'dim-distance'};if(keys[key])setTool(keys[key]);}
});window.addEventListener('keyup',e=>{if(e.key==='Shift'&&drag?.kind==='rotation')updateMouseRotation({clientX:drag.client.x,clientY:drag.client.y,shiftKey:false});if(e.key===' '){space=false;paper.style.cursor='';}});window.addEventListener('blur',()=>{if(drag?.kind==='erase')cancelErase();if(drag?.kind==='rotation')cancelMouseRotation();space=false;paper.style.cursor='';});
window.addEventListener('paste',e=>{
 if(Date.now()-clipboardPasteGuard<600||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||document.querySelector('dialog[open]:not(#selection-dialog)'))return;
 const objects=parseClipboardPayload(e.clipboardData?.getData('text/plain')||'');
 if(!objects)return;
 e.preventDefault();clipboard=objects;clipboardPastes=0;pasteObjects(objects);
});
for(const key of ['lineTool','shapeTool','cornerTool','editTool'])syncGroupTool(preferences[key]);
syncControls();setTool('select');requestAnimationFrame(fit);
projectManager=new ProjectController({getState:()=>state,getHistory:()=>({undo:undoStack,redo:redoStack}),replace:replaceProject,toast});
projectManager.ready.catch(error=>toast('工程库初始化失败：'+error.message+'。当前图纸可下载保存。'));

})();
