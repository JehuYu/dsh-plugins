/* Interface conveniences; all drawing mutations stay in app.js. */
(()=>{
 'use strict';
 const $=s=>document.querySelector(s), dialog=$('#command-dialog'), search=$('#command-search'), results=$('#command-results');
 const commands=[
  ['选择 / 框选','select','V','i-select','工具','select selection'],
  ['整体移图','move-view','M','i-move','工具','move'],['平移画布','pan','H','i-pan','视图','pan hand'],
  ['直线','line','L','i-line','绘制','line'],['折线','poly','P','i-poly','绘制','polyline'],
  ['圆弧','arc','A','i-arc','绘制','arc'],['形体 / 矩形','rect','B','i-rect','绘制','rectangle shape'],
  ['圆','circle','C','i-circle','绘制','circle'],['圆角','fillet','F','i-fillet','绘制','fillet'],['倒角','chamfer','⇧F','i-chamfer','绘制','chamfer bevel'],['文字','text','T','i-text','绘制','text'],
  ['橡皮擦','erase','X','i-erase','编辑','erase eraser'],['按点分割直线','split','S','i-split','编辑','split cut'],['延伸边线','extend','E','i-extend','编辑','extend'],['偏移边线','offset','O','i-offset','编辑','offset'],
  ['沿竖直中线镜像复制','#mirror-x','','i-mirror','编辑','mirror'],['沿水平中线镜像复制','#mirror-y','','i-mirror','编辑','mirror'],
  ['距离尺寸','dim-distance','D','i-dim','标注','distance dimension'],['直径尺寸','dim-diameter','⇧D','i-diameter','标注','diameter'],
  ['半径尺寸','dim-radius','R','i-radius','标注','radius'],['角度尺寸','dim-angle','G','i-angle','标注','angle'],
  ['导入图纸或模型','#import-btn','','i-upload','文件','import dxf svg stl obj'],
  ['保存可编辑工程','#save-btn','Ctrl S','i-save','文件','save sanview'],['导出图纸','#export-btn','','i-download','文件','export png svg pdf'],
  ['最近工程 / 快照 / 另存为','#projects-btn','','i-projects','文件','recent history recovery save as'],['构件模板','#template-btn','','i-cube','文件','template'],['新建空白图纸','#new-btn','','i-plus','文件','new'],
  ['撤销','#undo-btn','Ctrl Z','i-undo','编辑','undo'],['重做','#redo-btn','Ctrl Y','i-redo','编辑','redo'],
  ['复制所选对象','#copy-btn','Ctrl C','i-copy','编辑','copy'],['粘贴对象','#paste-btn','Ctrl V','i-paste','编辑','paste'],
  ['编辑所选对象','#selection-btn','','i-select','编辑','properties'],['尺寸编辑','#dimension-edit-toggle','','i-dim','设置','dimension edit'],
  ['吸附开关','#snap-toggle','','i-magnet','设置','snap'],['网格显示','#grid-toggle','','i-grid','设置','grid'],
  ['适应画布','#fit-btn','','i-fit','视图','fit zoom'],['切换专注模式','#focus-btn','','i-focus','视图','focus'],
  ['旋转所选对象','#rotate-btn','⇧R','i-rotate','编辑','rotate rotation'],['操作指南','#shortcuts-btn','?','i-help','帮助','help shortcuts']
 ];
 let matches=[],active=0;
 const target=c=>c[1].startsWith('#')?$(c[1]):$(`[data-tool="${c[1]}"]`)||$(['line','poly'].includes(c[1])?'#line-tool':['erase','split','extend','offset'].includes(c[1])?'#edit-tool':['fillet','chamfer'].includes(c[1])?'#corner-tool':'#shape-tool');
 const enabled=c=>!target(c)?.disabled;
 function activate(index,scroll=false){
  active=index;
  [...results.querySelectorAll('[role=option]')].forEach((el,i)=>{el.setAttribute('aria-selected',String(i===active));});
  const option=results.children[active];
  if(option?.matches('[role=option]')){search.setAttribute('aria-activedescendant',option.id);if(scroll)option.scrollIntoView({block:'nearest'});}
  else search.removeAttribute('aria-activedescendant');
 }
 function render(){
  const query=search.value.trim().toLowerCase();
  matches=commands.filter(c=>[c[0],c[2],c[4],c[5]].join(' ').toLowerCase().includes(query));
  results.replaceChildren();
  for(const [index,c] of matches.entries()){
   const button=document.createElement('button');button.type='button';button.className='command-result';button.id='quick-action-'+index;
   button.setAttribute('role','option');button.setAttribute('tabindex','-1');button.disabled=!enabled(c);
   button.innerHTML=`<svg aria-hidden="true"><use href="#${c[3]}"/></svg><span>${c[0]}</span><small>${c[4]}</small>${c[2]?`<kbd>${c[2]}</kbd>`:''}`;
   button.addEventListener('pointermove',()=>{if(!button.disabled)activate(index);});
   button.addEventListener('click',()=>execute(c));results.append(button);
  }
  if(!matches.length){const empty=document.createElement('p');empty.className='command-empty';empty.textContent='没有找到操作，试试“圆弧”“导出”或快捷键。';results.append(empty);}
  activate(matches.findIndex(enabled));
 }
 function openCommands(){
  if(document.querySelector('dialog[open]:not(#selection-dialog)'))return;
  $('#tool-options').hidden=true;search.value='';render();dialog.showModal();search.focus();
 }
 function execute(c){
  if(!enabled(c))return;
  dialog.close();
  if(c[1].startsWith('#')){$(c[1]).click();return;}
  if(['line','poly'].includes(c[1])){$('#line-tool').click();$(`[data-line-type="${c[1]}"]`).click();}
  else if(['fillet','chamfer'].includes(c[1])){$('#corner-tool').click();$(`[data-corner-tool="${c[1]}"]`).click();}
  else if(['rect','circle'].includes(c[1])){$('#shape-tool').click();$(`[data-shape-type="${c[1]}"]`).click();}
  else if(['erase','split','extend','offset'].includes(c[1])){$('#edit-tool').click();$(`[data-edit-type="${c[1]}"]`).click();}
  else $(`[data-tool="${c[1]}"]`).click();
 }
 $('#command-btn').addEventListener('click',openCommands);
 search.addEventListener('input',render);
 search.addEventListener('keydown',e=>{
  if(['ArrowDown','ArrowUp'].includes(e.key)){
   e.preventDefault();if(!matches.some(enabled))return;
   let next=active;do{next=(next+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;}while(!enabled(matches[next]));
   activate(next,true);
  }else if(e.key==='Enter'){e.preventDefault();if(matches[active])execute(matches[active]);}
 });
 $('#shortcuts-btn').addEventListener('click',()=>{$('#tool-options').hidden=true;$('#shortcuts-dialog').showModal();});
 const focusButton=$('#focus-btn');
 focusButton.addEventListener('click',()=>{
  const focused=document.body.classList.toggle('focus-mode');focusButton.setAttribute('aria-pressed',String(focused));
  focusButton.querySelector('span').textContent=focused?'退出专注':'专注';focusButton.title=focused?'展开绘图工具栏':'收起工具栏，扩大画布';
  $('#tool-options').hidden=true;
  if(!focused)$('.tool.active')?.scrollIntoView({block:'nearest'});
  // Refit once the column transition finishes, keeping the entire sheet visible.
  setTimeout(()=>window.dispatchEvent(new Event('resize')),matchMedia('(prefers-reduced-motion: reduce)').matches?0:350);
 });
 document.addEventListener('keydown',e=>{
  if(document.querySelector('.paper-shell.rotating'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
   e.preventDefault();if(dialog.open)dialog.close();else openCommands();
  }else if(e.key==='?'&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&!document.querySelector('dialog[open]:not(#selection-dialog)')){
   e.preventDefault();$('#shortcuts-btn').click();
  }
 });
 // Clicking outside a dialog closes it; dragging from a form field never does.
 for(const modal of document.querySelectorAll('dialog')){
  let startedOutside=false;
  const outside=e=>{const b=modal.getBoundingClientRect();return e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom;};
  modal.addEventListener('pointerdown',e=>{startedOutside=e.target===modal&&outside(e);});
  modal.addEventListener('click',e=>{if(startedOutside&&e.target===modal&&outside(e))modal.close();startedOutside=false;});
  modal.addEventListener('close',()=>{startedOutside=false;});
 }
 const save=$('#save-status');
 new MutationObserver(()=>{const text=save.textContent;save.classList.toggle('saving',text.includes('正在'));save.classList.toggle('save-error',text.includes('请'));save.title=text+' · 自动保存在当前浏览器';}).observe(save,{childList:true,characterData:true,subtree:true});
 // Labels follow grouped tool choices, including choices made with keyboard shortcuts.
 const toolNames={fillet:['圆角','F'],chamfer:['倒角','⇧F'],line:['直线','L'],poly:['折线','P'],arc:['圆弧','A'],rect:['形状','B'],circle:['圆','C'],erase:['橡皮擦','X'],split:['分割','S'],extend:['延伸','E'],offset:['偏移','O']};
 new MutationObserver(records=>{
  for(const {target:button} of records){
   const info=toolNames[button.dataset.tool];if(info){button.querySelector('.tool-label').textContent=info[0];button.querySelector('kbd').textContent=info[1];}
   if(button.getAttribute('aria-pressed')==='true'){
    button.classList.remove('just-activated');requestAnimationFrame(()=>button.classList.add('just-activated'));
    // A keyboard-selected tool should be visible on a short or compact screen.
    if(!document.body.classList.contains('focus-mode'))button.scrollIntoView({block:'nearest'});
   }
  }
 }).observe($('.tool-rail'),{attributes:true,subtree:true,attributeFilter:['aria-pressed']});
 // Keep long drawing instructions available to mouse users without widening the canvas footer.
 const hint=$('#tool-status');new MutationObserver(()=>{hint.title=hint.textContent;}).observe(hint,{childList:true,characterData:true,subtree:true});
 new MutationObserver(()=>{if($('#tool-options').hidden)for(const button of document.querySelectorAll('#line-tool,#arc-tool,#shape-tool,#corner-tool,#edit-tool'))button.setAttribute('aria-expanded','false');}).observe($('#tool-options'),{attributes:true,attributeFilter:['hidden']});
})();
