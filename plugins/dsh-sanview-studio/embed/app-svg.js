/* SVG import: an allowlisted geometry parser. Scripts, HTML, images, links and stylesheets never enter the document. */
(function(root){
'use strict';
const D=root.Draft;
const {pt,mul}=D;
const LAYER='drawing';
function readTransform(s){let m=[1,0,0,1,0,0];for(const match of String(s||'').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)){const name=match[1],a=(match[2].match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[]).map(Number);let t=[1,0,0,1,0,0];if(name==='matrix'&&a.length===6)t=a;else if(name==='translate')t[4]=a[0]||0,t[5]=a[1]||0;else if(name==='scale')t[0]=a[0]??1,t[3]=a[1]??a[0]??1;else if(name==='rotate'){let v=(a[0]||0)*Math.PI/180;t=[Math.cos(v),Math.sin(v),-Math.sin(v),Math.cos(v),0,0];if(a.length===3)t=D.matrixMultiply(D.matrixMultiply([1,0,0,1,a[1],a[2]],t),[1,0,0,1,-a[1],-a[2]]);}else if(name==='skewX')t[2]=Math.tan((a[0]||0)*Math.PI/180);else if(name==='skewY')t[1]=Math.tan((a[0]||0)*Math.PI/180);m=D.matrixMultiply(m,t);}return m;}
function parseSvg(text){
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('SVG 格式无效');const root=doc.documentElement,objects=[];let skipped=0;
 const finite=n=>Number.isFinite(n)&&Math.abs(n)<1e7,read=(el,k,def=0)=>{const raw=el.getAttribute(k);if(raw==null)return def;const n=parseFloat(raw);if(!finite(n))throw Error('SVG 包含无效坐标');if(/%/.test(raw))throw Error('暂不支持百分比坐标，请导出为绝对坐标 SVG');return n;};
 const view=(root.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number);let rootMatrix=[1,0,0,1,0,0];
 const width=root.getAttribute('width')||'',height=root.getAttribute('height')||'';
 const mm=v=>v.endsWith('mm')?parseFloat(v):v.endsWith('cm')?parseFloat(v)*10:v.endsWith('in')?parseFloat(v)*25.4:v.endsWith('pt')?parseFloat(v)*25.4/72:parseFloat(v)*25.4/96;
 if(view.length===4&&view.every(finite)&&view[2]>0&&view[3]>0){const w=width&&!width.includes('%')?mm(width):view[2]*25.4/96;const h=height&&!height.includes('%')?mm(height):view[3]*25.4/96;const preserve=root.getAttribute('preserveAspectRatio')||'xMidYMid meet';let sx=w/view[2],sy=h/view[3],dx=0,dy=0;if(!preserve.includes('none')){const sc=preserve.includes('slice')?Math.max(sx,sy):Math.min(sx,sy);dx=(w-view[2]*sc)*(preserve.includes('xMin')?0:preserve.includes('xMax')?1:.5);dy=(h-view[3]*sc)*(preserve.includes('YMin')?0:preserve.includes('YMax')?1:.5);sx=sy=sc;}rootMatrix=[sx,0,0,sy,dx-view[0]*sx,dy-view[1]*sy];}
 else rootMatrix=[25.4/96,0,0,25.4/96,0,0];
 const cssRules=[];for(const node of doc.querySelectorAll('style'))for(const r of node.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g))for(const selector of r[1].split(',')){const s=selector.trim();if(/^(?:[a-zA-Z]+)?(?:[.#][a-zA-Z_][\w-]*)?$/.test(s))cssRules.push({selector:s,css:r[2]});}
 const styleVal=(el,k,inherit)=>{let value=el.getAttribute(k);for(const r of cssRules)if(el.matches(r.selector)){const match=r.css.match(new RegExp('(?:^|;)\\s*'+k+'\\s*:\\s*([^;]+)'));if(match)value=match[1].trim();}const inline=el.getAttribute('style')||'',match=inline.match(new RegExp('(?:^|;)\\s*'+k+'\\s*:\\s*([^;]+)'));return (match?match[1].trim():value)??inherit;};
 const seen=new Set();
 function walk(el,parent,inherited={},depth=0){if(depth>50)throw Error('SVG 嵌套过深');if(el.getAttribute('data-arrow-halo')==='true')return;const tag=el.localName;if(['script','foreignObject','image','style','metadata','title','desc','filter','clipPath','mask','pattern','marker','linearGradient','radialGradient'].includes(tag)){if(!['title','desc','metadata'].includes(tag))skipped++;return;}if(tag==='defs')return;
  if(styleVal(el,'display','')==='none'||styleVal(el,'visibility','')==='hidden')return;
  let m=D.matrixMultiply(parent,readTransform(el.getAttribute('transform')));if(!m.every(finite))throw Error('SVG 变换无效');
  const css={stroke:styleVal(el,'stroke',inherited.stroke??'none'),dash:styleVal(el,'stroke-dasharray',inherited.dash??''),fill:styleVal(el,'fill',inherited.fill??'black'),width:styleVal(el,'stroke-width',inherited.width??'1'),size:styleVal(el,'font-size',inherited.size??'12')};
  if(tag==='use'){const href=el.getAttribute('href')||el.getAttribute('xlink:href')||'';if(!href.startsWith('#')){skipped++;return;}const target=doc.getElementById(href.slice(1));if(target&&!seen.has(target)){seen.add(target);walk(target,D.matrixMultiply(m,[1,0,0,1,read(el,'x'),read(el,'y')]),css,depth+1);seen.delete(target);}return;}
  if(tag==='g'||tag==='svg'||tag==='symbol'||tag==='a'){if(tag==='svg'&&el!==root){skipped++;return;}for(const c of el.children)walk(c,m,css,depth+1);return;}
  const trans=p=>D.transform(p,m),strokeStyle=css.dash&&css.dash!=='none'?(css.dash.split(/[ ,]+/).length>=4?'center':'hidden'):'solid';let o;
  if(tag==='line')o=D.shape('line',{p1:trans(pt(read(el,'x1'),read(el,'y1'))),p2:trans(pt(read(el,'x2'),read(el,'y2')))},LAYER,strokeStyle);
  else if(tag==='rect'){const x=read(el,'x'),y=read(el,'y'),w=read(el,'width'),h=read(el,'height');if(w<=0||h<=0)return;const pts=[pt(x,y),pt(x+w,y),pt(x+w,y+h),pt(x,y+h)].map(trans);if(Math.abs(m[1])<1e-8&&Math.abs(m[2])<1e-8)o=D.shape('rect',{p1:pts[0],p2:pts[2]},LAYER,strokeStyle);else o=D.shape('poly',{points:pts,closed:true},LAYER,strokeStyle);if(read(el,'rx')||read(el,'ry')){const rx=Math.min(read(el,'rx',read(el,'ry')),w/2),ry=Math.min(read(el,'ry',read(el,'rx')),h/2);o=D.shape('path',{segments:D.parsePath(`M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`),matrix:m},LAYER,strokeStyle);}}
  else if(tag==='circle'||tag==='ellipse'){const cx=read(el,'cx'),cy=read(el,'cy'),rx=read(el,tag==='circle'?'r':'rx'),ry=read(el,tag==='circle'?'r':'ry');if(rx<=0||ry<=0)return;const a=pt(m[0]*rx,m[1]*rx),b=pt(m[2]*ry,m[3]*ry);if(Math.abs(D.len(a)-D.len(b))<1e-5&&Math.abs(a.x*b.x+a.y*b.y)<1e-5)o=D.shape('circle',{c:trans(pt(cx,cy)),r:D.len(a)},LAYER,strokeStyle);else o=D.shape('path',{segments:D.parsePath(`M${cx-rx} ${cy}A${rx} ${ry} 0 1 0 ${cx+rx} ${cy}A${rx} ${ry} 0 1 0 ${cx-rx} ${cy}Z`),matrix:m},LAYER,strokeStyle);}
  else if(tag==='path'){const d=el.getAttribute('d')||'';if(!d.trim())return;o=D.shape('path',{segments:D.parsePath(d),matrix:m},LAYER,strokeStyle);}
  else if(tag==='polygon'||tag==='polyline'){const n=(el.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);if(n.length%2||!n.every(finite))throw Error('SVG 多边形坐标无效');const points=[];for(let i=0;i<n.length;i+=2)points.push(trans(pt(n[i],n[i+1])));if(points.length<2)return;o=D.shape('poly',{points,closed:tag==='polygon'},LAYER,strokeStyle);}
  else if(tag==='text'){o=D.shape('text',{p:trans(pt(read(el,'x'),read(el,'y'))),text:el.textContent.slice(0,200),size:Math.max(1,Math.min(20,(parseFloat(css.size)||12)*Math.hypot(m[0],m[1]))),align:['start','middle','end'].includes(el.getAttribute('text-anchor'))?el.getAttribute('text-anchor'):'start'},LAYER);if(el.children.length)skipped++;}
  else {skipped++;return;}
  if(o){if(o.type!=='text'&&css.stroke==='none'&&['white','#fff','#ffffff','none'].includes(css.fill.toLowerCase()))return;if(objects.length>=3000)throw Error('SVG 对象过多，请精简至 3000 个以内');if(o.type!=='text'){const width=(parseFloat(css.width)||1)*Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]));o.width=Math.max(.1,Math.min(2,width));}objects.push(o);}
 }
 walk(root,rootMatrix);if(!objects.length)throw Error('未发现可编辑的矢量图形；请导入含路径或基本形状的 SVG');
 if(objects.reduce((n,o)=>n+(o.segments?.length||o.points?.length||1),0)>30000)throw Error('SVG 节点过多，请简化后导入');
 // Measure only regenerated, escaped geometry, never user SVG markup.
 const measure=document.createElementNS(D.NS,'svg');measure.style.cssText='position:fixed;left:-100000px;top:-100000px;visibility:hidden;stroke:none';measure.innerHTML='<g>'+objects.map(o=>D.renderShape(o)).join('')+'</g>';document.body.appendChild(measure);let bounds;try{bounds=measure.firstElementChild.getBBox();}finally{measure.remove();}
 const minX=bounds.x,maxX=bounds.x+bounds.width,minY=bounds.y,maxY=bounds.y+bounds.height;
 if(![minX,maxX,minY,maxY].every(finite))throw Error('SVG 坐标或变换超出支持范围');
 const w=maxX-minX,h=maxY-minY,fitScale=Math.min(1,230/(w||1),130/(h||1));
 const offset=pt(35-minX*fitScale,48-minY*fitScale);
 for(const o of objects){D.scaleObject(o,fitScale);D.move(o,offset);}
 return {objects,skipped,fitScale};
}
root.SvgImport={parseSvg,readTransform};
})(typeof window!=='undefined'?window:globalThis);
