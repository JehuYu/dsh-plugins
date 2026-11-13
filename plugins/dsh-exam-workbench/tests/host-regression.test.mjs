import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { readXlsxAllSheets } from '../xlsx.js'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'exam-host-offline-'))
process.env.DSH_HOME=path.join(root,'home')
process.env.APPDATA=path.join(root,'appdata')
const archive=path.join(root,'archive'), exam='20300101高一期末考', grade=path.join(archive,exam,'高一')
await fs.mkdir(path.join(grade,'01语文'),{recursive:true})
await fs.mkdir(path.join(grade,'02技术'),{recursive:true})
for(const [dir,name] of [['01语文','高一语文主观.xlsx'],['01语文','高一语文客观.xlsx'],['02技术','高一信息选主观.xlsx'],['02技术','高一通用客观.xlsx']]) await fs.writeFile(path.join(grade,dir,name),'fixture')
function zip(files, advertised){let parts=[],cen=[],off=0; for(const [name,text] of Object.entries(files)){let n=Buffer.from(name),raw=Buffer.from(text),data=deflateRawSync(raw),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(8,8);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);parts.push(h,n,data);let c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(8,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(advertised??raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(off,42);cen.push(c,n);off+=h.length+n.length+data.length}let cb=Buffer.concat(cen),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(cen.length/2,10);e.writeUInt32LE(cb.length,12);e.writeUInt32LE(off,16);return Buffer.concat([...parts,cb,e])}
const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>姓名</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>语文</t></is></c><c r="B2" t="inlineStr"><is><t>张老师★</t></is></c></row></sheetData></worksheet>'
const files={'xl/workbook.xml':'<workbook><sheets><sheet name="高一" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/sharedStrings.xml':'<sst><si><t>科目</t></si></sst>','xl/worksheets/sheet1.xml':sheet}
const workbook=zip(files)
await fs.writeFile(path.join(archive,'教师组长.xlsx'),workbook)
const entry=path.join(process.env.APPDATA,'npm/node_modules/dingtalk-workspace-cli/bin/dws.js')
await fs.mkdir(path.dirname(entry),{recursive:true}); await fs.writeFile(entry,'// offline sentinel: never execute')
const calls=[];let throwSpawn=false;let archiveMode=false
cp.execFile=(command,args,options,done)=>{calls.push({command,args,env:options.env});if(throwSpawn)throw new Error('fixture spawn failure');queueMicrotask(async()=>{try {if(archiveMode&&args.includes('+messages-resource-download')) {await fs.writeFile(path.join(options.cwd,'download.xlsx'),'offline downloaded bytes');done(null,'{}','')} else done(null,JSON.stringify({messages:archiveMode?[{text:'[文件] 高一语文主观评分标准.xlsx fileId: abc='}]:[]}), '')}catch(e){done(e,'','fixture download failed')}});return {kill(){}}}
const readdir=fs.readdir
let slow=false
fs.readdir=async(...args)=>{if(slow)await new Promise(r=>setTimeout(r,30));return readdir(...args)}
syncBuiltinESMExports()
const {apply}=await import('../archive-host.js')
const routes=new Map(),disposers=[]
const host={webServer:{register(r){let k=r.kind+':'+r.path;assert.ok(!routes.has(k));routes.set(k,r);return()=>routes.delete(k)}},effect(fn){disposers.push(fn())}}
apply({inject(keys,fn){assert.deepEqual(keys,['webServer']);fn(host)}},{archiveRoot:archive,rosterDir:archive,groupName:"离线测试群",sendReminders:false})
const handler=routes.get('prefix:/exam-archive').handler
async function request(endpoint,body,raw){let req=new EventEmitter();req.url='/exam-archive/api/'+endpoint;req.method=body===undefined?'GET':'POST';req.destroy=()=>{req.destroyed=true};let res={headers:{},setHeader(k,v){this.headers[k]=v},end(text){this.text=text;this.writableEnded=true}};const done=handler(req,res);if(body!==undefined)setImmediate(()=>{req.emit('data',Buffer.from(raw??JSON.stringify(body)));req.emit('end')});await done;return {code:res.statusCode,body:JSON.parse(res.text)}}
await test('XLSX worker preserves sheets, shared strings, inline strings',async()=>{const result=await readXlsxAllSheets(workbook);assert.equal(result.sheets[0].name,'高一');assert.equal(result.sheets[0].rows[0][0],'科目');assert.equal(result.sheets[0].rows[1][1],'张老师★')})
await test('XLSX malformed ZIP / zip expansion / hostile row / truncated stream reject',async()=>{await assert.rejects(readXlsxAllSheets(Buffer.from('bad')));await assert.rejects(readXlsxAllSheets(zip(files,20*1024*1024)),/限制/);await assert.rejects(readXlsxAllSheets(zip({...files,'xl/worksheets/sheet1.xml':sheet.replace('r="1"','r="4294967294"')})),/行号/);await assert.rejects(readXlsxAllSheets(workbook.subarray(0,workbook.length-15)))})
await test('state, activation, subject completeness and leader mapping',async()=>{let r=await request('state');assert.equal(r.code,200);assert.equal(r.body.roster.count,1);r=await request('activate',{examName:exam});assert.equal(r.body.status.total,3);assert.equal(r.body.status.done,1);assert.equal(r.body.status.subjects.find(s=>s.subject==='语文').leader,'张老师');assert.equal(r.body.status.subjects.find(s=>s.subject==='信息').complete,false);assert.equal((await request('scan',{examName:exam})).body.status.total,3)})
await test('times and reminder dry run persist to local fixture',async()=>{assert.equal((await request('times',{examName:exam,entry:{grade:'高一',subject:'语文',start:'09:00',end:'10:00'}})).code,200);let r=await request('remind',{examName:exam});assert.equal(r.body.count,2);assert.equal(r.body.sent,false);const stored=JSON.parse(await fs.readFile(path.join(process.env.DSH_HOME,'exam-archive/data.json'),'utf8'));assert.equal(stored.reminders.length,2);assert.equal(stored.examTimes[exam]['高一|语文'].start,'09:00');assert.equal(calls.length,0)})
await test('delayed network IO leaves Host event loop responsive and rejects overlapping action',async()=>{slow=true;let ticks=0;const timer=setInterval(()=>ticks++,5);const pending=request('scan',{examName:exam});await new Promise(r=>setTimeout(r,15));assert.equal((await request('scan',{examName:exam})).code,409);await pending;clearInterval(timer);slow=false;assert.ok(ticks>=3,'Host timer must run while scan waits');console.log('HOST_EVENT_LOOP_TICKS='+ticks)})
await test('malformed request and missing directory return handled errors',async()=>{for(const body of [null,[],42])assert.equal((await request('scan',body)).code,400);assert.equal((await request('scan',{},'{oops')).code,400);assert.equal((await request('scan',{examName:'missing'})).code,500);assert.equal((await request('scan',{examName:'../escape'})).code,500)})
await test('offline download renames and archives bytes into matching subject directory',async()=>{archiveMode=true;const r=await request('archive',{examName:exam});archiveMode=false;assert.equal(r.body.done,1);assert.equal(await fs.readFile(path.join(grade,'01语文','高一语文主观评分标准.xlsx'),'utf8'),'offline downloaded bytes')})
await test('Electron DWS spawn uses node mode; synchronous spawn errors settle',async()=>{Object.defineProperty(process.versions,'electron',{value:'offline-fixture',configurable:true});let r=await request('fetch',{});assert.equal(r.body.ok,true);assert.equal(calls.at(-1).command,'node');assert.equal(calls.at(-1).env.ELECTRON_RUN_AS_NODE,'1');throwSpawn=true;r=await request('fetch',{});assert.equal(r.body.ok,false);assert.match(r.body.error,/fixture spawn failure/);delete process.versions.electron;throwSpawn=false})
await test('API route disposes and registers again without collision; obsolete CSS route absent',()=>{assert.equal(routes.size,1);assert.ok(!routes.has('exact:/exam-archive/styles.css'));for(const d of disposers)d();assert.equal(routes.size,0);apply({inject(keys,fn){fn(host)}},{archiveRoot:archive,rosterDir:archive});for(const d of disposers)d();assert.equal(routes.size,0)})
const cleanupTarget = path.resolve(root)
assert.equal(path.dirname(cleanupTarget), path.resolve(os.tmpdir()))
assert.ok(path.basename(cleanupTarget).startsWith('exam-host-offline-'))
await fs.rm(cleanupTarget, { recursive: true, force: true })
console.log('Offline fixture cleaned: ' + cleanupTarget)
