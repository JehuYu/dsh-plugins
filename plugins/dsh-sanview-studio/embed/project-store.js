/* Local project library. Editing history and recovery copies belong to each project. */
(function(root){
'use strict';
const copy=o=>JSON.parse(JSON.stringify(o)),uid=()=>`p${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`;
class Library{
 constructor(raw){this.writer=uid();this.data=raw&&raw.version===1&&Array.isArray(raw.projects)?copy(raw):{version:1,activeId:null,projects:[]};}
 current(){return this.data.projects.find(p=>p.id===this.data.activeId);}
 create(doc){const project={id:uid(),writer:this.writer,updated:Date.now(),doc:copy(doc),undo:[],redo:[],snapshots:[]};this.data.projects.unshift(project);this.data.activeId=project.id;return project;}
 save(doc,undo=[],redo=[]){const project=this.current()||this.create(doc);project.doc=copy(doc);project.writer=this.writer;project.undo=copy(undo.slice(-20));project.redo=copy(redo.slice(-20));project.updated=Date.now();return project;}
 snapshot(label='自动快照',force=false){const project=this.current();if(!project)return;const last=project.snapshots[0];if(!force&&last&&JSON.stringify(last.doc)===JSON.stringify(project.doc))return;project.snapshots.unshift({id:uid(),created:Date.now(),label,doc:copy(project.doc)});project.snapshots=project.snapshots.slice(0,10);}
 activate(id){const project=this.data.projects.find(p=>p.id===id);if(!project)throw Error('工程不存在');this.data.activeId=id;project.updated=Date.now();return copy(project);}
 restore(id){const project=this.current(),snapshot=project?.snapshots.find(s=>s.id===id);if(!snapshot)throw Error('快照不存在');const doc=copy(snapshot.doc);this.snapshot('恢复快照之前',true);project.undo.push(JSON.stringify(project.doc));project.undo=project.undo.slice(-20);project.redo=[];project.doc=doc;project.updated=Date.now();return copy(project);}
 list(){return [...this.data.projects].sort((a,b)=>b.updated-a.updated);}
}
function mergeLibraries(previous,incoming){
 if(!previous?.projects)return copy(incoming);const out=copy(incoming),projects=new Map(previous.projects.map(p=>[p.id,copy(p)]));
 for(const project of out.projects){const old=projects.get(project.id);if(!old){projects.set(project.id,project);continue;}const winner=project.updated>=old.updated?project:old,loser=winner===project?old:project,snapshots=new Map([...(winner.snapshots||[]),...(loser.snapshots||[])].map(s=>[s.id,s]));
  if((!winner.writer||winner.writer!==loser.writer)&&JSON.stringify(winner.doc)!==JSON.stringify(loser.doc)&&!Array.from(snapshots.values()).some(s=>JSON.stringify(s.doc)===JSON.stringify(loser.doc))){const id=uid();snapshots.set(id,{id,created:loser.updated,label:'其他页面 / 保存前版本',doc:copy(loser.doc)});}
  winner.snapshots=[...snapshots.values()].sort((a,b)=>b.created-a.created).slice(0,10);projects.set(project.id,winner);
 }out.projects=[...projects.values()];return out;
}
async function openBackend(){
 try{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('sanview-project-library',1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('工程库被占用'));});
  const access=(mode,value)=>new Promise((resolve,reject)=>{const tx=db.transaction('data',mode),store=tx.objectStore('data'),request=store.get('library');let result;request.onsuccess=()=>{result=request.result;if(mode==='readwrite'){result=mergeLibraries(result,value);store.put(result,'library');}};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('保存中断'));});
  return {read:()=>access('readonly'),write:data=>access('readwrite',data),kind:'indexeddb'};
 }catch{
  return {read:async()=>JSON.parse(localStorage.getItem('sanview-project-library-v1')||'null'),write:async data=>localStorage.setItem('sanview-project-library-v1',JSON.stringify(data)),kind:'localstorage'};
 }
}
root.ProjectStore={Library,mergeLibraries,openBackend};if(typeof module!=='undefined'&&module.exports)module.exports=root.ProjectStore;
})(typeof window!=='undefined'?window:globalThis);
