'use strict';
importScripts('model3d.js?v=19');
let model=null;
self.onmessage=event=>{const {id,action,data,name,options}=event.data;try{if(action==='load'){model=ModelViews.parse(data,name);self.postMessage({id,info:{name:model.name,format:model.format,faces:model.triangles.length,size:model.box.size,warnings:model.warnings}});}else if(action==='generate'){if(!model)throw Error('请先导入模型');self.postMessage({id,result:ModelViews.generate(model,options)});}}catch(error){self.postMessage({id,error:error.message||'模型处理失败'});}};
