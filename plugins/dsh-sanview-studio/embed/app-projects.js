/* Project switching preserves the current drawing before activating another one. */
(function(root){
'use strict';
const D=root.Draft,Doc=root.SanviewDoc,$=s=>document.querySelector(s);
class Controller{
 constructor(ctx){this.ctx=ctx;this.queue=Promise.resolve();this.ready=this.initialize();this.bind();}
 async initialize(){
  const legacy=D.clone(this.ctx.getState());this.backend=await root.ProjectStore.openBackend();this.library=new root.ProjectStore.Library(await this.backend.read());let current=this.library.current();
  if(!current)current=this.library.create(legacy);
  else {current.doc=Doc.validateDoc(current.doc);if(JSON.stringify(current.doc)!==JSON.stringify(legacy)){current.undo.push(JSON.stringify(current.doc));this.library.save(legacy,current.undo,[]);}}
  this.library.snapshot('自动恢复点');this.ctx.replace(current.doc,current.undo,current.redo);await this.write();return this;
 }
 write(){const data=D.clone(this.library.data);this.queue=this.queue.catch(()=>{}).then(()=>this.backend.write(data));return this.queue;}
 async save(){await this.ready;const history=this.ctx.getHistory(),project=this.library.save(this.ctx.getState(),history.undo,history.redo);if(!project.snapshots[0]||Date.now()-project.snapshots[0].created>=30000)this.library.snapshot();await this.write();}
 async start(doc){await this.save();this.library.snapshot('新建工程之前');this.library.create(Doc.validateDoc(doc));this.library.snapshot('创建工程');this.ctx.replace(doc,[],[]);await this.write();}
 async open(id){await this.save();this.library.snapshot('切换工程之前');const project=this.library.activate(id);this.ctx.replace(project.doc,project.undo,project.redo);await this.write();this.render();}
 async restore(id){await this.save();const project=this.library.restore(id);this.ctx.replace(project.doc,project.undo,project.redo);await this.write();this.render();this.ctx.toast('快照已恢复，恢复前版本也已保留');}
 render(){
  const library=this.library,active=library.current(),date=n=>new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  $('#recent-projects').innerHTML=library.list().map(project=>`<button type="button" class="recent-project ${project.id===active.id?'active':''}" data-open-project="${D.esc(project.id)}"><span><b>${D.esc(project.doc.title||'未命名图纸')}</b><small>${project.doc.objects.length} 个对象 · ${date(project.updated)}</small></span><small>${project.id===active.id?'当前工程':'打开'}</small></button>`).join('');
  $('#project-snapshots').innerHTML=active.snapshots.length?active.snapshots.map(snapshot=>`<button type="button" class="project-snapshot" data-restore-snapshot="${D.esc(snapshot.id)}"><span><b>${D.esc(snapshot.label)}</b><small>${date(snapshot.created)} · ${snapshot.doc.objects.length} 个对象</small></span><small>恢复</small></button>`).join(''):'<p class="muted">尚无快照</p>';
  $('#project-library-status').textContent='本机自动保存 · '+(this.backend.kind==='indexeddb'?'工程库':'浏览器存储');
 }
 run(action){return Promise.resolve().then(action).catch(error=>{this.ctx.toast(error.message||'工程库暂时无法写入，请下载工程保留副本');});}
 bind(){
  $('#projects-btn').addEventListener('click',()=>this.run(async()=>{await this.save();this.library.data=root.ProjectStore.mergeLibraries(await this.backend.read(),this.library.data);this.render();$('#save-as-title').value=(this.ctx.getState().title||'未命名图纸')+' 副本';$('#projects-dialog').showModal();}));
  $('#recent-projects').addEventListener('click',e=>{const button=e.target.closest('[data-open-project]');if(button)this.run(()=>this.open(button.dataset.openProject));});
  $('#project-snapshots').addEventListener('click',e=>{const button=e.target.closest('[data-restore-snapshot]');if(button)this.run(()=>this.restore(button.dataset.restoreSnapshot));});
  $('#snapshot-project').addEventListener('click',()=>this.run(async()=>{await this.save();this.library.snapshot('手动快照',true);await this.write();this.render();this.ctx.toast('已保存手动快照');}));
  $('#save-as-form').addEventListener('submit',e=>{e.preventDefault();this.run(async()=>{const title=$('#save-as-title').value.trim();if(!title)throw Error('请输入工程名称');await this.start({...D.clone(this.ctx.getState()),title:title.slice(0,100)});this.render();this.ctx.toast('已另存为独立工程');});});
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='s'&&!document.querySelector('dialog[open]:not(#selection-dialog)')){e.preventDefault();e.stopPropagation();$('#projects-btn').click();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.run(()=>this.save());});
 }
}
root.ProjectController=Controller;
})(typeof window!=='undefined'?window:globalThis);
