/**
 * dsh-ameqp-grading — Client half.
 *
 * 三页结构，跟随 DSH 主题 token：
 *  - login（首页）：阅卷地址 / 账号 / 密码。
 *  - work（阅卷工作台）：选择项目→科目→题目，加载答卷图，逐份给分/提交，或启动 AI 自动阅卷。
 *  - settings（设置页）：按题目维护题干/题干图、参考答案图、题目特化提示词、评分项；总提示词；模型/API。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-exam-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React
    const NS = 'ameqp-grading'

    const CSS = `
/* 账号栏与整体骨架：断点依据面板宽度，不依赖浏览器窗口。 */
.ag-shell,.ag-page{min-width:0}
.ag-shell *,.ag-page *{box-sizing:border-box}
.ag-shell{container:ag-panel / inline-size;box-sizing:border-box;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;
  --tl:var(--dsw-alias-border-l1);--tl2:var(--dsw-alias-border-l2);
  --tc:var(--dsw-alias-bg-layer-1);--tc2:var(--dsw-alias-bg-layer-2);
  --tm:var(--dsw-alias-label-secondary);--tb:var(--dsw-alias-brand-primary);
  --ok:var(--dsw-alias-state-success-primary);--warn:var(--dsw-alias-state-warn-primary);--err:var(--dsw-alias-state-error-primary)}
.ag-rail{flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 20px;padding:14px 24px;border-bottom:1px solid var(--tl);background:var(--tc);min-width:0}
.ag-rail-label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary)}
.ag-rail-label svg{color:var(--tb)}
.ag-rail-main{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0}
.ag-rail-pick{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 260px}
.ag-rail-label{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary);flex:none;letter-spacing:.02em}
.ag-rail-pick select{box-sizing:border-box;flex:1 1 auto;min-width:0;max-width:320px;border:1px solid var(--tl2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;border-radius:8px;padding:6px 10px;outline:none}
.ag-rail-pick select:focus{border-color:var(--tb);box-shadow:0 0 0 3px color-mix(in srgb,var(--tb) 14%,transparent)}
.ag-rail-status{display:flex;align-items:center;gap:8px;flex:1 1 220px;min-width:0}
.ag-rail-status-text{font-size:12px;color:var(--tm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ag-dot.live{animation:ag-pulse 1.8s ease-in-out infinite}
@keyframes ag-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.ag-rail-actions{display:flex;gap:6px;flex:none;flex-wrap:wrap}
.ag-rail-drawer{flex:0 1 auto;min-height:0;max-height:45%;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border-bottom:1px solid var(--tl);padding-top:10px}
.ag-rail-note{padding:0 18px 10px;min-width:0}
.ag-rail-note .ag-err,.ag-rail-note .ag-ok{margin:0 0 8px}
.ag-rail-body{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.ag-hint{font-size:11px;color:var(--tm);line-height:1.5}
.ag-form-title{font-size:12.5px;font-weight:640;margin-bottom:10px}
.ag-task-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:4px 0 8px;font-size:11.5px;font-weight:640}
.ag-tasks{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:8px;padding-bottom:2px}
.ag-task{border:1px solid var(--tl);border-radius:14px;background:var(--tc);padding:16px;min-width:0;display:flex;flex-direction:column;gap:10px;position:relative}
.ag-task.sel{border-color:color-mix(in srgb,var(--tb) 40%,var(--tl));box-shadow:inset 3px 0 0 var(--tb);background:color-mix(in srgb,var(--tb) 3%,var(--tc))}
.ag-task-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
.ag-task-id{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px}
.ag-task-id b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.ag-task-state{font-size:11px;color:var(--tm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%;flex:none;text-align:right}
.ag-task-state.live{color:var(--tb)}
.ag-task-state.bad{color:var(--warn)}
.ag-task-state.idle{color:var(--tm)}
.ag-task-flag{font-size:10px;font-weight:640;padding:1px 7px;border-radius:999px;flex:none;line-height:16px}
.ag-task-flag.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.ag-task-flag.live{background:color-mix(in srgb,var(--tb) 16%,transparent);color:var(--tb)}
.ag-task-meta{font-size:11px;color:var(--tm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-task-nums{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--tm);font-variant-numeric:tabular-nums}
.ag-task-nums b{color:var(--dsw-alias-label-primary);font-weight:640}
.ag-task-nums .strong b{color:var(--warn)}
.ag-task-nums .bad b{color:var(--err)}
.ag-task-nums .live{color:var(--tb)}
.ag-task-ops{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;padding-top:12px;border-top:1px solid var(--tl)}

.ag-page{container:ag-workbench / inline-size;box-sizing:border-box;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;
  --tl:var(--dsw-alias-border-l1);--tl2:var(--dsw-alias-border-l2);
  --tc:var(--dsw-alias-bg-layer-1);--tc2:var(--dsw-alias-bg-layer-2);
  --tm:var(--dsw-alias-label-secondary);--tb:var(--dsw-alias-brand-primary);
  --ok:var(--dsw-alias-state-success-primary);--warn:var(--dsw-alias-state-warn-primary);--err:var(--dsw-alias-state-error-primary)}
.ag-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}
.ag-in{max-width:1280px;margin:0 auto;padding:32px 36px 56px}
.ag-scroll{scrollbar-gutter:stable}
.ag-shell button:focus-visible,.ag-page button:focus-visible,.ag-settings-nav button:focus-visible{outline:2px solid var(--tb);outline-offset:3px}
.ag-settings-layout{display:grid;grid-template-columns:160px minmax(0,1fr);gap:32px;align-items:start;margin-top:28px}
.ag-settings-nav{position:sticky;top:20px;display:flex;flex-direction:column;gap:6px}
.ag-settings-nav button{display:flex;align-items:center;gap:10px;padding:11px 12px;border:0;background:transparent;border-radius:10px;color:var(--tm);text-align:left;font:inherit;font-size:12px;font-weight:550;cursor:pointer;transition:background-color .15s,color .15s}
.ag-settings-nav button:hover{color:var(--tb);background:color-mix(in srgb,var(--tb) 7%,var(--tc))}
.ag-settings-nav button span{font-size:10px;opacity:.6;font-variant-numeric:tabular-nums}
.ag-settings-content{min-width:0}
.ag-settings-section{margin-bottom:0}
.ag-settings-section[hidden]{display:none}
.ag-settings-nav button.on{color:var(--tb);background:color-mix(in srgb,var(--tb) 9%,var(--tc));box-shadow:inset 2px 0 0 var(--tb)}
.ag-settings-section>.ag-sec{margin-top:0}
.ag-selector .ag-body{padding:18px 20px}
.ag-selector .ag-row{gap:16px}
.ag-toolbar{padding:16px 20px;border:1px solid var(--tl);border-radius:14px;background:var(--tc);align-items:center}
.ag-paper-label{font-size:11px;color:var(--tm);font-weight:550;display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}
.ag-output{margin:18px 0}
.ag-output-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;color:var(--tm)}
.ag-output-head b{font-weight:600;color:var(--dsw-alias-label-primary)}
.ag-output pre{margin:0;padding:16px;min-height:112px;max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-base);border:1px solid var(--tl);border-radius:12px}

.ag-b{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--tl2);background:var(--tc);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;font-weight:560;border-radius:9px;padding:8px 16px;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s,filter .15s,transform .05s;white-space:nowrap}
.ag-b:hover:enabled{border-color:var(--tb);background:color-mix(in srgb,var(--tb) 5%,var(--tc))}
.ag-b:active:enabled{transform:translateY(.5px)}
.ag-b:disabled{opacity:.42;cursor:default}
.ag-b.pri{background:var(--tb);border-color:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:640;box-shadow:0 1px 2px color-mix(in srgb,var(--tb) 28%,transparent)}
.ag-b.pri:hover:enabled{filter:brightness(1.06)}
.ag-b.sm{padding:5px 12px;font-size:11.5px;border-radius:8px}
.ag-b.ghost{background:transparent;border-color:transparent;color:var(--tm);font-weight:500}
.ag-b.ghost:hover:enabled{background:var(--tc2);border-color:transparent;color:var(--dsw-alias-label-primary)}
.ag-b.danger{color:var(--err);border-color:color-mix(in srgb,var(--err) 40%,var(--tl2))}
.ag-b.danger:hover:enabled{background:color-mix(in srgb,var(--err) 7%,var(--tc));border-color:var(--err)}

.ag-field{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%}
.ag-field input,.ag-field select,.ag-field textarea{width:100%;max-width:100%}
.ag-row>.ag-field{flex:1 1 150px}
.ag-err,.ag-ok,.ag-hint,.ag-run-phase,.ag-crit .d{overflow-wrap:anywhere}
.ag-field label{font-size:11px;font-weight:600;color:var(--tm);letter-spacing:.02em}
.ag-field input,.ag-field select,.ag-field textarea{box-sizing:border-box;border:1px solid var(--tl2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;border-radius:9px;padding:8px 11px;outline:none;transition:border-color .15s,box-shadow .15s;min-width:0}
.ag-field input::placeholder{color:var(--tm);opacity:.7}
.ag-field input:focus,.ag-field select:focus,.ag-field textarea:focus{border-color:var(--tb);box-shadow:0 0 0 3px color-mix(in srgb,var(--tb) 14%,transparent)}
.ag-field textarea{resize:vertical;min-height:70px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.6}

.ag-tag{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 9px;font-size:10.5px;line-height:17px;white-space:nowrap;font-weight:600;flex:none}
.ag-tag.m{background:var(--tc2);color:var(--tm);font-weight:500}
.ag-tag.b{background:color-mix(in srgb,var(--tb) 14%,transparent);color:var(--tb)}
.ag-tag.g{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}
.ag-tag.w{background:color-mix(in srgb,var(--warn) 15%,transparent);color:var(--warn)}
.ag-tag.e{background:color-mix(in srgb,var(--err) 15%,transparent);color:var(--err)}
.ag-dot{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none}

.ag-err{border:1px solid color-mix(in srgb,var(--err) 40%,transparent);background:color-mix(in srgb,var(--err) 8%,transparent);color:var(--err);border-radius:10px;padding:9px 12px;font-size:11.5px;margin-bottom:12px;line-height:1.5}
.ag-ok{border:1px solid color-mix(in srgb,var(--ok) 40%,transparent);background:color-mix(in srgb,var(--ok) 8%,transparent);color:var(--ok);border-radius:10px;padding:9px 12px;font-size:11.5px;margin-bottom:12px;line-height:1.5}
.ag-empty{padding:32px 16px;text-align:center;color:var(--tm);font-size:12px;line-height:1.7}
.ag-empty-paper{min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:radial-gradient(ellipse at center,color-mix(in srgb,var(--tb) 4%,transparent),transparent 65%)}
.ag-empty-paper svg{color:color-mix(in srgb,var(--tb) 55%,var(--tm));margin-bottom:6px}
.ag-empty-paper b{font-weight:550;font-size:14px;color:var(--dsw-alias-label-primary)}
.ag-spin{display:inline-block;width:11px;height:11px;border:2px solid color-mix(in srgb,var(--tm) 35%,transparent);border-top-color:var(--tm);border-radius:50%;animation:ag-spin .8s linear infinite;vertical-align:-1px}
.ag-b.pri .ag-spin{border-color:rgba(255,255,255,.35);border-top-color:#fff}
@keyframes ag-spin{to{transform:rotate(360deg)}}

.ag-sec{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:28px 0 14px;font-size:14px;line-height:1.5;font-weight:620;color:var(--dsw-alias-label-primary);letter-spacing:-.01em}
.ag-sec::after{content:"";height:1px;background:var(--tl);flex:1;min-width:20px;margin-left:4px}
.ag-card{border:1px solid var(--tl);border-radius:16px;background:var(--tc);overflow:hidden;box-shadow:0 3px 12px color-mix(in srgb,var(--dsw-alias-label-primary) 2%,transparent)}
.ag-body{padding:22px 24px}
.ag-row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.ag-g{flex:1;min-width:0}

.ag-head{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:1px solid var(--tl);margin-bottom:8px;flex-wrap:wrap}
.ag-who{min-width:0;flex:1 1 220px}
.ag-page-title{margin:0 0 8px;font-size:26px;line-height:1.3;font-weight:650;letter-spacing:-.04em}
.ag-who-name{font-size:12px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.ag-who-meta{display:flex;align-items:center;gap:10px;min-width:0}
.ag-who-host{font-size:11px;color:var(--tm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px}
.ag-head-right{display:flex;align-items:center;gap:16px;flex:none;flex-wrap:wrap}
.ag-brand{display:flex;align-items:center;gap:11px;min-width:0}
.ag-brand-ic{width:36px;height:36px;border-radius:10px;background:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff);display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 2px 6px color-mix(in srgb,var(--tb) 32%,transparent)}
.ag-brand h1{margin:0;font-size:16px;line-height:20px;font-weight:660}
.ag-brand .sub{color:var(--tm);font-size:11px;line-height:14px;margin-top:1px}
.ag-seg{display:inline-flex;background:var(--tc2);border:1px solid var(--tl);border-radius:12px;padding:4px;gap:4px}
.ag-seg button{border:1px solid transparent;background:transparent;color:var(--tm);font:inherit;font-size:12px;line-height:20px;font-weight:550;border-radius:8px;padding:7px 18px;cursor:pointer;transition:background-color .14s,color .14s}
.ag-seg button:hover{color:var(--dsw-alias-label-primary)}
.ag-seg button.on{background:var(--tc);border-color:var(--tl);color:var(--tb);box-shadow:0 2px 4px color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}

/* 登录只保留项目名称与表单。 */
.ag-login-backdrop{background:radial-gradient(ellipse at 50% 20%,color-mix(in srgb,var(--tb) 6%,transparent),transparent 65%),var(--dsw-alias-bg-base)}
.ag-login{width:100%;max-width:480px;min-height:100%;margin:0 auto;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:40px 24px}
.ag-login:has(#ag-login-decisions){max-width:900px;justify-content:flex-start}
.ag-login-card{width:100%;max-width:432px;align-self:center;flex:none;border:1px solid var(--tl);border-radius:22px;background:var(--tc);box-shadow:0 16px 48px color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);overflow:hidden}
.ag-login-hero{padding:32px 30px 4px;display:flex;align-items:center;gap:12px}
.ag-login-brand-mark{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:13px;background:color-mix(in srgb,var(--tb) 10%,var(--tc));color:var(--tb)}
.ag-login-hero h1{margin:0;font-size:22px;font-weight:650;letter-spacing:-.03em;line-height:1.5}
.ag-login-form{padding:24px 30px 30px;display:flex;flex-direction:column;gap:18px}
.ag-login-form .ag-field{gap:8px}
.ag-login-form .ag-field label{font-size:12px;letter-spacing:0;font-weight:550}
.ag-login-form .ag-field input{height:44px;border-radius:11px;padding:11px 12px;background:var(--dsw-alias-bg-base);font-size:13px}
.ag-login-credentials{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
.ag-login-actions{display:flex;margin-top:6px}
.ag-login-actions .ag-b{width:100%;min-height:44px;font-size:13px;border-radius:11px}
.ag-login-trial{min-width:0;text-align:center}
.ag-login-trial>.ag-b{font-size:11px}
#ag-login-decisions{text-align:left}

.ag-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}
.ag-metric{border:1px solid var(--tl);border-radius:12px;background:var(--tc2);padding:12px 14px}
.ag-metric b{display:block;font-size:21px;font-weight:680;font-variant-numeric:tabular-nums;line-height:1.1}
.ag-metric span{font-size:10.5px;color:var(--tm)}
.ag-list{display:flex;flex-direction:column}
.ag-item{display:flex;align-items:center;gap:12px;padding:9px 14px;border-bottom:1px solid var(--tl)}
.ag-item:last-child{border-bottom:0}
.ag-item .k{font-size:12.5px;font-weight:640;font-variant-numeric:tabular-nums}
.ag-item .v{color:var(--tm);font-size:11px}
.ag-thumb{border:1px solid var(--tl);border-radius:6px;background:#fff;max-height:60px;max-width:90px;object-fit:contain;display:block}
.ag-img{border:1px solid var(--tl);border-radius:10px;background:#fff;max-width:100%;max-height:300px;object-fit:contain;display:block}
.ag-paste{border:1.5px dashed var(--tl2);border-radius:10px;background:var(--tc2);color:var(--tm);font-size:11px;line-height:1.5;padding:10px 12px;cursor:pointer;min-height:52px;display:flex;align-items:center;justify-content:center;text-align:center;transition:border-color .15s,background-color .15s;user-select:none}
.ag-paste:hover{border-color:var(--tb)}
.ag-paste.on{border-color:var(--tb);background:color-mix(in srgb,var(--tb) 8%,var(--tc2));color:var(--dsw-alias-label-primary)}
.ag-paste.has{border-style:solid;border-color:var(--ok);background:color-mix(in srgb,var(--ok) 6%,var(--tc2))}

/* 阅卷工作台 */
.ag-mark{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;align-items:start}
.ag-paper{min-width:0;padding:18px;border:1px solid var(--tl);border-radius:16px;background:var(--tc2)}
.ag-paper-img{border:1px solid var(--tl);border-radius:10px;background:#fff;width:100%;min-height:320px;padding:12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}
.ag-paper-img img{max-width:100%;max-height:64vh;object-fit:contain;display:block}
.ag-run{border-bottom:1px solid var(--tl);padding-bottom:18px;margin-bottom:18px}
.ag-run-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.ag-run-phase{font-size:12.5px;font-weight:620;min-width:0}
.ag-run-model{font-size:11px;color:var(--tm);margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ag-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}
.ag-stat{border:1px solid var(--tl);border-radius:12px;background:var(--dsw-alias-bg-base);padding:14px;min-width:0}
.ag-stat:first-child{background:color-mix(in srgb,var(--tb) 6%,var(--tc));border-color:color-mix(in srgb,var(--tb) 16%,var(--tl))}
.ag-stat:first-child b{color:var(--tb)}
.ag-stat b{display:block;font-size:23px;font-weight:620;line-height:1.2;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.ag-stat span{display:block;font-size:11px;color:var(--tm);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-detail{margin-top:8px;font-size:11px;color:var(--tm)}
.ag-detail summary{cursor:pointer;user-select:none;width:fit-content}
.ag-detail-body{display:flex;flex-direction:column;gap:3px;padding:6px 0 0;font-variant-numeric:tabular-nums}
.ag-fold>summary{cursor:pointer;user-select:none;font-size:12px;font-weight:620;padding:2px 0;list-style:none;display:flex;align-items:baseline;gap:8px}
.ag-fold>summary::-webkit-details-marker{display:none}
.ag-fold>summary::before{content:"▸";font-size:10px;color:var(--tm);transition:transform .15s}
.ag-fold[open]>summary::before{transform:rotate(90deg)}
.ag-fold>summary:hover{color:var(--tb)}
.ag-nav{display:flex;align-items:center;gap:10px;margin-top:12px}
.ag-nav .pos{font-size:12px;color:var(--tm);font-variant-numeric:tabular-nums}
.ag-score-num{display:flex;align-items:baseline;gap:8px}
.ag-score-num input{width:80px;font-size:22px;font-weight:680;text-align:center;padding:8px;font-variant-numeric:tabular-nums}
.ag-score-num span{color:var(--tm);font-size:14px}
.ag-quick{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.ag-quick button{min-width:34px;height:34px;border:1px solid var(--tl2);background:var(--tc);border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.ag-quick button.on{background:var(--tb);border-color:var(--tb);color:var(--dsw-alias-label-primary-foreground,#fff)}
.ag-crit{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--tl)}
.ag-crit:last-child{border-bottom:0}
.ag-crit .d{flex:1;font-size:12px;line-height:1.5}
.ag-crit input{width:64px;text-align:center;font-variant-numeric:tabular-nums}

/* 面板与工作台分别建立容器，拖窄面板也会触发断点。 */
@container ag-panel (max-width:900px){
  .ag-rail{grid-template-columns:minmax(0,1fr);padding:10px 14px}
  .ag-rail-note{padding:0 14px 10px}
}
@container ag-workbench (max-width:900px){
  .ag-in{padding:24px 20px 48px}
  .ag-mark{grid-template-columns:minmax(0,1fr)}
  .ag-paper-img img{max-height:46vh}
  .ag-settings-layout{grid-template-columns:minmax(0,1fr);gap:24px}
  .ag-settings-nav{position:static;flex-direction:row;flex-wrap:wrap;gap:4px;padding-bottom:14px;border-bottom:1px solid var(--tl)}
  .ag-settings-nav button{padding:8px 10px}
  .ag-login{padding:28px 20px}
}
@container ag-panel (max-width:640px){
  .ag-rail{padding:8px 12px;gap:6px}
  .ag-rail-main{gap:6px}
  .ag-rail-note{padding:0 12px 10px}
  .ag-rail-pick{flex:1 1 100%}
  .ag-rail-pick select{max-width:none}
  .ag-rail-status{flex:1 1 100%}
  .ag-rail-actions{width:100%}
  .ag-rail-actions .ag-b{flex:1 1 auto}
  .ag-tasks{grid-template-columns:minmax(0,1fr)}
  .ag-task-top{align-items:flex-start;flex-wrap:wrap}
  .ag-task-state{max-width:100%;text-align:left}
  .ag-task-ops{width:100%;justify-content:flex-start}
}
@container ag-workbench (max-width:640px){
  .ag-in{padding:14px 12px 44px}
  .ag-body{padding:16px}
  .ag-paper{padding:12px}
  .ag-paper-img{min-height:220px;padding:8px}
  .ag-page-title{font-size:22px}
  .ag-who-meta{flex-wrap:wrap;gap:6px 10px}
  .ag-who-host{max-width:100%}
  .ag-settings-nav button span{display:none}
  .ag-head{gap:16px}
  .ag-head-right{width:100%;justify-content:space-between}
  .ag-row>.ag-field{flex-basis:100%!important}
  .ag-row>.ag-b{white-space:normal;max-width:100%}
  .ag-login{padding:24px 12px}
  .ag-login-form{padding:22px 20px}
  .ag-login-hero{padding:24px 20px 0}
  .ag-login-credentials{grid-template-columns:minmax(0,1fr)}
  .ag-metrics,.ag-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ag-sec{margin:18px 0 10px;flex-wrap:wrap}
  .ag-nav{flex-wrap:wrap}
  .ag-item{flex-wrap:wrap;overflow-wrap:anywhere}
}
@media (prefers-reduced-motion:reduce){
  .ag-dot.live{animation:none}
}
`

    let resolvedApiBase = null
    const apiCandidates = () => {
      try {
        return [...new Set([new URL('ameqp-grading/api/', document.baseURI).href, new URL('/ameqp-grading/api/', document.baseURI).href])]
      } catch { return ['/ameqp-grading/api/'] }
    }
    const apiBase = () => resolvedApiBase || apiCandidates()[0]

    async function getState(accountId = null, signal) {
      let lastError
      const candidates = [...new Set([resolvedApiBase, ...apiCandidates()].filter(Boolean))]
      for (const base of candidates) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        try {
          if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          const abort = () => controller.abort()
          signal?.addEventListener('abort', abort, { once: true })
          let res
          try { res = await fetch(base + (accountId ? 'accounts/' + encodeURIComponent(accountId) + '/state' : 'state'), { cache: 'no-store', signal: controller.signal }) }
          finally { signal?.removeEventListener('abort', abort) }
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          if (!data || typeof data.connected !== 'boolean') throw new Error('后端返回了无效状态，请检查插件是否加载')
          resolvedApiBase = base
          return data
        } catch (error) {
          if (signal?.aborted) throw error
          lastError = error?.name === 'AbortError' ? new Error('状态读取超时（8秒）') : error
        } finally { clearTimeout(timer) }
      }
      throw lastError || new Error('阅卷后端不可用')
    }
    async function requestJson(op, body) {
      const res = await fetch(apiBase() + op, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      })
      const data = await res.json().catch(() => ({ error: '响应无法解析' }))
      if (!res.ok || (data && data.error)) throw new Error((data && (data.message || data.error)) || 'HTTP ' + res.status)
      return data
    }

    function Icon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M8 8.5h8M8 12h8M8 15.5h4.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M15 15.5l1.6 1.6 2.6-2.9', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function StreamOutput({ stream }) {
      const pane = useRef(null)
      const follow = useRef(true)
      const paper = useRef(stream?.paperId)
      useEffect(() => {
        if (paper.current !== stream?.paperId) { paper.current = stream?.paperId; follow.current = true }
        if (follow.current && pane.current) pane.current.scrollTop = pane.current.scrollHeight
      }, [stream?.text, stream?.paperId])
      if (!stream) return null
      const status = { waiting: '等待评分正文', streaming: '接收中', completed: '输出完成', error: '输出失败', cancelled: '已中断' }[stream.status] || stream.status
      return h('section', { className: 'ag-output', 'data-testid': 'grading-stream' },
        h('div', { className: 'ag-output-head' }, h('b', null, 'AI 当前输出'), h('span', null, `${status} · ${stream.chars || 0} 字符`)),
        h('pre', { ref: pane, role: 'log', 'aria-label': 'AI当前评分输出', 'aria-live': 'off',
          onScroll: (e) => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 } },
          stream.text || (stream.status === 'waiting' ? '模型处理中，等待首段评分正文…' : '当前请求未返回评分正文。')),
        stream.truncated ? h('div', { style: { fontSize: 11, color: 'var(--tm)' } }, '仅显示最近一段输出；完整响应仍用于评分校验。') : null)
    }

    function ManualResolution({ claim, selection, maxScore, blocked, onResolved, postJson }) {
      const [score, setScore] = useState(() => typeof claim.score === 'number' ? String(claim.score) : '')
      const [working, setWorking] = useState(false)
      const [message, setMessage] = useState('')
      const locked = useRef(false)
      const validMax = typeof maxScore === 'number' && Number.isFinite(maxScore) && maxScore > 0
      const value = score.trim() === '' ? NaN : Number(score)
      const validScore = validMax && Number.isInteger(value) && value >= 0 && value <= maxScore
      const payload = { ...selection, ansQueSN: claim.ansQueSN }
      const resolve = async (action, continueAi = false) => {
        if (locked.current || blocked) return
        if (action === 'submit' && !validScore) { setMessage('请输入0至本题满分之间的整数总分'); return }
        locked.current = true; setWorking(true); setMessage('')
        let submitted = false
        try {
          if (action === 'cancel') {
            await postJson('marking-cancel', payload)
            await onResolved('已取消当前领卷，未提交分数')
          } else {
            await postJson('marking-submit', { ...payload, value, points: [] })
            submitted = true
            if (continueAi) await postJson('marking-auto-resume', {})
            await onResolved(continueAi ? '本份已人工提交，AI 阅卷已继续' : '本份已人工提交，AI 保持停止')
          }
        } catch (error) {
          const text = submitted ? '本份已提交；继续AI时出现错误：' + error.message : error.message || String(error)
          setMessage(text)
          await onResolved(text, true)
        } finally { locked.current = false; setWorking(false) }
      }
      return h('section', { 'data-testid': 'manual-resolution', style: { margin: '12px 0', padding: 12, border: '1px solid var(--tl2)', borderRadius: 8 } },
        h('b', null, claim.needs_human_review ? '人工复核当前答卷' : '人工处理当前答卷'),
        claim.review_reason ? h('div', { style: { marginTop: 8, whiteSpace: 'pre-wrap' } }, claim.review_reason) : null,
        (claim.criteria || []).length ? h('details', { style: { marginTop: 8 } }, h('summary', null, '查看 AI 分项依据'),
          claim.criteria.map((c) => h('div', { key: c.id, style: { marginTop: 6, fontSize: 12 } }, `${c.id}：${c.score ?? '未定'} / ${c.max_score}；${c.image_evidence || c.reason || '未提供依据'}`))) : null,
        h('div', { className: 'ag-field', style: { margin: '10px 0' } },
          h('label', { htmlFor: `manual-score-${claim.ansQueSN}` }, '人工最终分（整数）'),
          h('input', { id: `manual-score-${claim.ansQueSN}`, type: 'number', min: 0, max: validMax ? maxScore : undefined, step: 1,
            value: score, disabled: blocked || working, placeholder: validMax ? `0～${maxScore}分` : '满分待获取', onChange: (event) => setScore(event.target.value) })),
        !validMax ? h('div', { className: 'ag-err' }, '本题满分未知，请先载入题目配置') : null,
        blocked ? h('div', { className: 'ag-err' }, '当前请求尚未结束或提交结果未确认，请等待或在原系统核对后处理') : null,
        message ? h('div', { className: 'ag-err', role: 'alert' }, message) : null,
        h('div', { className: 'ag-row' },
          h('button', { className: 'ag-b', disabled: blocked || working || !validScore, onClick: () => resolve('submit') }, '人工提交本份'),
          h('button', { className: 'ag-b pri', disabled: blocked || working || !validScore, onClick: () => resolve('submit', true) }, '人工提交并继续 AI'),
          h('button', { className: 'ag-b', disabled: blocked || working, onClick: () => resolve('cancel') }, '取消当前领卷')))
    }

    function DecisionsTrial({ postJson, configForm, maxScore, promptText, stemImage, refImage, selectionKey, sampleOnly = false }) {
      const [mode, setMode] = useState('custom')
      const [sample, setSample] = useState('sample001')
      const [question, setQuestion] = useState('q13')
      const [apiKey, setApiKey] = useState('') // Deliberately never passed to draft or configuration storage.
      const [scoreStep, setScoreStep] = useState('0.25')
      const [images, setImages] = useState([])
      const [working, setWorking] = useState(false)
      const [reading, setReading] = useState(false)
      const [error, setError] = useState('')
      const [result, setResult] = useState(null)
      const mounted = useRef(true)
      const locked = useRef(false)
      const sequence = useRef(0)
      const readerSequence = useRef(0)
      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false; sequence.current++; readerSequence.current++ }
      }, [])
      useEffect(() => {
        if (mode !== 'custom') return
        sequence.current++; setResult(null)
      }, [mode, configForm, maxScore, promptText, stemImage, refImage, selectionKey])
      const change = (setter, value) => { sequence.current++; setResult(null); setError(''); setter(value) }
      const addImages = async (files) => {
        if (working || reading) return
        const selected = Array.from(files || [])
        if (!selected.length) return
        const attachments = Number(!!stemImage) + Number(!!refImage)
        if (selected.length + images.length + attachments > 4) { setError(`总图片最多4张，已包含题干/参考图 ${attachments} 张；请移除多余图片后重试，不会自动丢弃图片`); return }
        if (selected.some((f) => !String(f.type || '').startsWith('image/'))) { setError('请选择图片文件'); return }
        if (selected.some((f) => f.size > 2 * 1024 * 1024)) { setError('每张作答图请控制在2MB以内'); return }
        const current = ++readerSequence.current
        setReading(true); setError('')
        try {
          const urls = await Promise.all(selected.map((file) => new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/') ? resolve(reader.result) : reject(new Error('作答图片读取失败'))
            reader.onerror = () => reject(new Error('作答图片读取失败，请重新选择'))
            reader.readAsDataURL(file)
          })))
          if (mounted.current && current === readerSequence.current) { setImages((v) => [...v, ...urls]); setResult(null); sequence.current++ }
        } catch (e) { if (mounted.current && current === readerSequence.current) setError(e.message) }
        finally { if (mounted.current && current === readerSequence.current) setReading(false) }
      }
      const run = async () => {
        if (locked.current || reading) return
        const body = { score_step: Number(scoreStep), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }
        try {
          if (mode === 'sample') body.sample = { id: sample, question_key: question }
          else {
            if (!images.length) throw new Error('请至少上传或粘贴一张作答图')
            if (images.length + Number(!!stemImage) + Number(!!refImage) > 4) throw new Error('总图片最多4张（含题干图和参考图），请移除多余图片；不会自动丢弃图片')
            if (!selectionKey || configForm.selection_key !== selectionKey) throw new Error('请先载入当前题目配置，再使用自图试评')
            if (!Number.isFinite(Number(maxScore)) || Number(maxScore) <= 0) throw new Error('当前题目满分未知，请先载入题目配置')
            let criteria
            try { criteria = JSON.parse(configForm.criteria || '[]') } catch { throw new Error('当前评分项 JSON 格式错误，请先修正') }
            if (!Array.isArray(criteria) || !criteria.length) throw new Error('当前题目尚无评分项，请先完善题目配置')
            body.config = { ...configForm, criteria, max_score: Number(maxScore), stem_image: stemImage || null, reference_image: refImage || null }
            body.prompt = promptText
            body.answer_images = [...images]
          }
        } catch (e) { setError(e.message); return }
        const current = ++sequence.current
        locked.current = true; setWorking(true); setError(''); setResult(null)
        try {
          const reply = await postJson('decisions-test', body)
          if (!mounted.current || current !== sequence.current) return
          if (reply?.test_only !== true || reply?.submitted !== false) throw new Error('试验响应缺少仅测试标记，请检查后端版本')
          setResult(reply)
        } catch (e) { if (mounted.current && current === sequence.current) setError(e.message || String(e)) }
        finally { locked.current = false; if (mounted.current) setWorking(false) }
      }
      const percent = (value) => typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '—'
      if (sampleOnly) return h('p', { role: 'status' }, '公开版不附带考试或学生样本。连接自己的阅卷站点并配置题目后，可上传有权使用的图片进行试评。')
      return h(React.Fragment, null,
        h('div', { className: 'ag-sec' }, 'Decisions 评分试验', h('span', { className: 'ag-tag w' }, '仅试验 · 不写回')),
        h('section', { className: 'ag-card', 'data-testid': 'decisions-trial', onPaste: (event) => {
          const files = Array.from(event.clipboardData?.items || []).filter((item) => item.type?.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean)
          if (!files.length) return
          event.preventDefault(); event.stopPropagation()
          if (mode === 'custom') addImages(files)
          else setError('请先切换到「当前配置 + 自传作答图」再粘贴作答图')
        } }, h('div', { className: 'ag-body' },
          h('p', { style: { marginTop: 0, color: 'var(--tm)', lineHeight: 1.6 } }, '独立调用 decisions-api.dev 的 Decisions 模型。仅对样本或自传图片试评，不领卷、不提交、不改变正式模型和任务设置。每次点击会产生第三方调用，积分以返回结果为准。'),
          h('div', { className: 'ag-row', style: { marginBottom: 12 } },
            h('div', { className: 'ag-field', style: { flex: '1 1 240px' } }, h('label', { htmlFor: 'ag-decisions-key' }, 'Decisions API Key（仅本次页面内存）'),
              h('input', { id: 'ag-decisions-key', type: 'password', value: apiKey, autoComplete: 'off', disabled: working, placeholder: '留空使用后端环境变量', onChange: (e) => change(setApiKey, e.target.value) })),
            h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-decisions-mode' }, '试验来源'),
              h('select', { id: 'ag-decisions-mode', value: mode, disabled: working || reading, onChange: (e) => change(setMode, e.target.value) },
                h('option', { value: 'custom' }, '当前配置 + 自传作答图'))),
            h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-decisions-step' }, '试评分数步长'),
              h('select', { id: 'ag-decisions-step', value: scoreStep, disabled: working, onChange: (e) => change(setScoreStep, e.target.value) }, [0.25, 0.5, 1].map((v) => h('option', { key: v, value: String(v) }, v + ' 分'))))),
          mode === 'sample' ? h('div', { className: 'ag-row', style: { marginBottom: 12 } },
            h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-decisions-sample' }, '内置作答样本'),
              h('select', { id: 'ag-decisions-sample', value: sample, disabled: working, onChange: (e) => change(setSample, e.target.value) }, Array.from({ length: 10 }, (_, i) => { const id = 'sample' + String(i + 1).padStart(3, '0'); return h('option', { key: id, value: id }, id) }))),
            h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-decisions-question' }, '样本题型 / 标准'),
              h('select', { id: 'ag-decisions-question', value: question, disabled: working, onChange: (e) => change(setQuestion, e.target.value) },
                [['q13', 'Q13 设计草图'], ['q11', 'Q11 三视图'], ['q12-lines', 'Q12 补线'], ['q12-isometric', 'Q12 轴测图']].map(([id, label]) => h('option', { key: id, value: id }, label)))))
            : h('div', { style: { marginBottom: 12 } },
              h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-decisions-images' }, '试验作答图（至少一张）'),
                h('input', { id: 'ag-decisions-images', type: 'file', multiple: true, accept: 'image/*', disabled: working || reading, onChange: (e) => addImages(e.target.files) })),
              h('div', { className: 'ag-paste', tabIndex: 0, role: 'region', 'aria-label': '粘贴 Decisions 试验作答图', style: { marginTop: 8 } }, reading ? '正在读取图片…' : '选择上方文件，或在此处 Ctrl+V 粘贴作答图；作答图每张不超过2MB，总图片最多4张（含题干/参考图），合计不超过8MiB。'),
              h('div', { style: { color: 'var(--tm)', fontSize: 11, marginTop: 6 } }, '使用当前题目的编辑草稿、满分、总提示词、题干图和参考答案图。试验图片不进入题目草稿。'),
              images.length ? h('div', { className: 'ag-row', style: { marginTop: 8 } }, images.map((src, index) => h('div', { key: index },
                h('img', { className: 'ag-thumb', src, alt: '试验作答图 ' + (index + 1) }),
                h('button', { className: 'ag-b sm ghost', disabled: working || reading, onClick: () => change(setImages, images.filter((_, i) => i !== index)) }, '移除作答图 ' + (index + 1))))) : null),
          h('p', { style: { fontSize: 11, color: 'var(--tm)' } }, '评分按所选步长分档（默认0.25分），不是选项概率的软均值。后端还会校验每张图不超过16M像素、所有图合计不超过8MiB；不符合时会显示错误，不会删图重试。'),
          error ? h('div', { className: 'ag-err', role: 'alert' }, error) : null,
          h('button', { className: 'ag-b', disabled: working || reading || (mode === 'custom' && !images.length), onClick: run }, working ? 'Decisions 试评中…' : '运行 Decisions 试评'),
          result ? h('div', { 'data-testid': 'decisions-result', style: { marginTop: 14 } },
            h('div', { className: 'ag-tag g' }, '仅试验 · 未提交'),
            h('p', null, `试评总分 ${result.score ?? '—'} / ${result.max_score ?? '—'} · 原始分 ${result.raw_score ?? '—'}${result.needs_human_review ? ' · 需人工复核' : ''}`),
            h('p', { style: { fontSize: 11, color: 'var(--tm)' } }, `模型 ${result.model || '—'} · ${result.provider || '—'} · 协议 ${result.protocol || '—'} · 请求 ${result.requestId || '—'}`),
            h('p', { style: { fontSize: 12 } }, `总耗时 ${result.elapsedMs ?? '—'}ms · 上游 ${result.upstreamElapsedMs ?? '—'}ms · 积分 ${result.creditsUsed ?? '未返回'}`),
            h('div', { className: 'ag-err' }, '概率和置信度仅供诊断，不是评分准确率；请与教师标准对照核验。'),
            h('div', { style: { overflowX: 'auto' } }, h('table', { style: { width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' } },
              h('thead', null, h('tr', null, ['分项', '分数 / 满分', '置信度', '选项概率', '分布'].map((label) => h('th', { key: label, style: { padding: 6, borderBottom: '1px solid var(--tl)' } }, label)))),
              h('tbody', null, (result.criteria || []).map((c, i) => h('tr', { key: c.id || i },
                h('td', { style: { padding: 6 } }, c.id), h('td', null, `${c.score ?? '—'} / ${c.max_score ?? '—'}`), h('td', null, typeof c.confidence === 'number' ? percent(c.confidence) : c.confidence || '—'), h('td', null, percent(c.probability)), h('td', { style: { maxWidth: 280, overflowWrap: 'anywhere' } }, c.distribution == null ? '—' : JSON.stringify(c.distribution))))))),
            result.reason ? h('p', { style: { whiteSpace: 'pre-wrap' } }, result.reason) : null,
            (result.warnings || []).length ? h('ul', null, result.warnings.map((warning, i) => h('li', { key: i }, warning))) : null,
            result.usage ? h('details', null, h('summary', null, '用量明细'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify(result.usage, null, 2))) : null) : null)))
    }

    function RecoveryResolution({ recovery, blocked, onResolve }) {
      const [note, setNote] = useState('')
      const locked = useRef(false)
      const resolve = async (resolution) => {
        if (locked.current || blocked || !note.trim()) return
        locked.current = true
        try { await onResolve(resolution, note.trim()) } finally { locked.current = false }
      }
      if (recovery.storageError) return h('section', { className: 'ag-err', role: 'alert', 'data-testid': 'recovery-resolution' },
        h('b', null, '恢复记录读取失败，已阻止新任务'), h('p', null, recovery.phase))
      const claim = recovery.claim || {}
      return h('section', { className: 'ag-err', 'data-testid': 'recovery-resolution' },
        h('b', null, '重启前答卷待核对'),
        h('p', null, `答卷 ${claim.ansQueSN == null ? '编号未知（领卷响应可能中断）' : claim.ansQueSN} · 考试 ${claim.selection?.exam ?? '未知'} / 科目 ${claim.selection?.subject ?? '未知'} / 题目 ${claim.selection?.question ?? '未知'}${claim.submissionUncertain ? ' · 提交结果未确认' : ''}`),
        h('p', null, '请先在原阅卷系统核对该账号的占卷和提交结果，再填写说明并明确确认。处理前不能启动新任务或领卷。'),
        h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-recovery-note' }, '原系统核对结果说明'),
          h('textarea', { id: 'ag-recovery-note', value: note, disabled: blocked, onChange: (e) => setNote(e.target.value), placeholder: '填写已核对的答卷、最终结果与依据', rows: 2 })),
        h('div', { className: 'ag-row', style: { marginTop: 10 } },
          h('button', { className: 'ag-b', disabled: blocked || !note.trim(), onClick: () => resolve('confirmed_submitted') }, '已在原系统确认提交'),
          h('button', { className: 'ag-b', disabled: blocked || !note.trim(), onClick: () => resolve('confirmed_cancelled') }, '已在原系统确认取消')))
    }

    // Drafts remain available across slot collapse even when browser storage is full.
    const draftMemory = new Map()
    const readDraft = (key) => {
      if (draftMemory.has(key)) return draftMemory.get(key)
      try { return sessionStorage.getItem(key) } catch { return null }
    }
    const writeDraft = (key, value) => {
      draftMemory.set(key, value)
      sessionStorage.setItem(key, value)
    }
    const accountPath = (accountId, op) => accountId ? 'accounts/' + encodeURIComponent(accountId) + '/' + op : op
    const taskOperation = (op) => /^(?:marking-(?:auto-(?:start|pause|resume|stop)|submit|cancel)|(?:job-)?(?:start|stop|pause|resume))$/.test(op)
    const modelLabel = (model) => typeof model === 'string' ? model : [model?.provider, model?.model].filter(Boolean).join(' / ') || '默认模型'

    async function getAccounts(signal) {
      let lastError
      let compatible = false
      for (const base of [...new Set([resolvedApiBase, ...apiCandidates()].filter(Boolean))]) {
        const controller = new AbortController()
        const abort = () => controller.abort()
        signal?.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(abort, 8000)
        try {
          if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          const res = await fetch(base + 'accounts', { cache: 'no-store', signal: controller.signal })
          if (res.status === 404) { compatible = true; continue }
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          if (!Array.isArray(data?.accounts)) { compatible = true; continue }
          resolvedApiBase = base
          return data
        } catch (error) {
          if (signal?.aborted) throw error
          lastError = error?.name === 'AbortError' ? new Error('账号状态读取超时（8秒）') : error
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      }
      if (compatible) return null
      throw lastError || new Error('无法读取账号列表')
    }

    function App() {
      const [directory, setDirectory] = useState(undefined)
      const [selected, setSelected] = useState('')
      const [expanded, setExpanded] = useState(false)
      const [adding, setAdding] = useState(false)
      const [form, setForm] = useState(() => {
        try { return { ...JSON.parse(localStorage.getItem('ameqp-grading-login') || '{}'), name: '' } }
        catch { return { base: '', username: '', password: '', name: '' } }
      })
      const [error, setError] = useState('')
      const [message, setMessage] = useState('')
      const [busy, setBusy] = useState('')
      const [refresh, setRefresh] = useState(0)
      const alive = useRef(true)
      const selectedRef = useRef('')
      const pending = useRef(null)
      const loadAccounts = useCallback(async (fresh = false) => {
        if (fresh === true) { pending.current?.controller.abort(); pending.current = null }
        if (pending.current) return pending.current.promise
        const controller = new AbortController()
        const entry = { controller }
        pending.current = entry
        entry.promise = (async () => {
          try {
            const next = await getAccounts(controller.signal)
            if (!alive.current || controller.signal.aborted) return
            setDirectory(next); setError('')
            if (next) {
              const current = selectedRef.current
              let saved = ''
              try { saved = sessionStorage.getItem('ameqp-grading-selectedAccount') || '' } catch { /* optional */ }
              const id = [current, saved, next.defaultAccountId, next.accounts[0]?.accountId].find((id) => next.accounts.some((a) => a.accountId === id)) || ''
              selectedRef.current = id; setSelected(id)
            }
          } catch (e) { if (alive.current && !controller.signal.aborted) setError('无法读取账号：' + e.message) }
          finally { if (pending.current === entry) pending.current = null }
        })()
        return entry.promise
      }, [])
      useEffect(() => {
        alive.current = true; loadAccounts()
        return () => { alive.current = false; pending.current?.controller.abort(); pending.current = null }
      }, [loadAccounts])
      useEffect(() => {
        if (!directory) return
        let disposed = false, timer
        const tick = async () => { await loadAccounts(); if (!disposed) timer = setTimeout(tick, document.hidden ? 5000 : 1800) }
        timer = setTimeout(tick, 1800)
        return () => { disposed = true; clearTimeout(timer) }
      }, [!!directory, loadAccounts])
      useEffect(() => {
        if (directory !== undefined || !error) return
        let disposed = false, timer
        const retry = async () => { await loadAccounts(); if (!disposed) timer = setTimeout(retry, 5000) }
        timer = setTimeout(retry, 3000)
        return () => { disposed = true; clearTimeout(timer) }
      }, [directory, error, loadAccounts])
      const choose = (id) => {
        selectedRef.current = id; setSelected(id)
        try { sessionStorage.setItem('ameqp-grading-selectedAccount', id) } catch { /* optional */ }
      }
      const control = async (account, op) => {
        const operation = account ? accountPath(account.accountId, op) : 'tasks/pause-all'
        if (busy) return
        setBusy(operation); setError(''); setMessage('')
        try {
          await requestJson(operation, account ? { taskId: account.taskId } : {})
          if (!alive.current) return
          await loadAccounts(true); setRefresh((n) => n + 1)
          setMessage(account ? '已向 ' + (account.name || account.username) + ' 发送任务操作' : '已向全部任务请求暂停；在途请求和提交仍需等待确认。')
        } catch (e) { if (alive.current) setError(e.message) }
        finally { if (alive.current) setBusy('') }
      }
      const addAccount = async () => {
        if (busy) return
        setBusy('accounts'); setError('')
        const submitted = { ...form }
        try {
          const result = await requestJson('accounts', submitted)
          if (!alive.current) return
          try { localStorage.setItem('ameqp-grading-login', JSON.stringify(submitted)) } catch { /* original credential semantics */ }
          await loadAccounts(true)
          if (result.accountId) choose(result.accountId)
          setAdding(false); setExpanded(false); setForm((v) => ({ ...v, password: '' }))
        } catch (e) { if (alive.current) setError('添加账号失败：' + e.message) }
        finally { if (alive.current) setBusy('') }
      }
      if (directory === null) return h(Workbench)
      const accounts = directory?.accounts || []
      const statusLabel = (a) => a.recovery?.pending ? '重启前答卷待核对' : a.autoMark?.submissionUncertain ? '待核对提交' : a.manualPending ? '持有人工答卷' : a.autoMark?.phase || a.job?.phase || (a.connected ? '已连接' : '未连接')
      const attention = (a) => a.recovery?.pending || a.autoMark?.submissionUncertain || a.autoMark?.failed || a.job?.failed || ['failed'].includes(a.autoMark?.status)
      const paused = (a) => a.autoMark?.status === 'paused' || a.autoMark?.status === 'stopped'
      const current = accounts.find((a) => a.accountId === selected)
      const runningCount = accounts.filter((a) => ['running', 'stopping'].includes(a.autoMark?.status) || a.autoMark?.inFlight).length
      const alertCount = accounts.filter(attention).length
      const reviewCount = accounts.reduce((n, a) => n + (a.autoMark?.review || 0), 0)
      const summary = [current ? statusLabel(current) : '未选择账号']
      if (runningCount) summary.push(`${runningCount} 个任务运行中`)
      if (reviewCount) summary.push(`${reviewCount} 份待复核`)
      if (alertCount) summary.push(`${alertCount} 个需处理`)
      return h('div', { className: 'ag-shell' }, h('style', { 'data-plugin': NS }, CSS),
        h('div', { className: 'ag-rail' },
          h('div', { className: 'ag-rail-main' },
            h('div', { className: 'ag-rail-pick' },
              h('span', { className: 'ag-rail-label' }, h(Icon, { size: 19 }), 'AMEQP'),
              h('select', { id: 'ag-account', 'aria-label': '当前阅卷账号', value: selected, onChange: (e) => choose(e.target.value) },
                accounts.map((a) => h('option', { key: a.accountId, value: a.accountId }, `${attention(a) ? '⚠ ' : paused(a) ? '⏸ ' : ''}${a.name || a.username || a.accountId}${a.isDefault ? '（默认）' : ''}`)))),
            h('div', { className: 'ag-rail-status' },
              h('span', { className: `ag-dot ${runningCount ? 'live' : ''}`, 'aria-hidden': true }),
              h('span', { className: 'ag-rail-status-text', title: summary.join(' · ') }, summary.join(' · ')))),
          h('div', { className: 'ag-rail-actions' },
            h('button', { className: 'ag-b sm', onClick: () => setExpanded(!expanded), 'aria-expanded': expanded }, expanded ? '收起全部任务' : '全部任务'),
            h('button', { className: 'ag-b sm', onClick: () => setAdding(!adding), 'aria-expanded': adding }, adding ? '取消添加' : '添加账号'),
            h('button', { className: 'ag-b sm', disabled: !!busy || !runningCount, onClick: () => control(null), title: '请求暂停全部运行中的任务' }, '全部暂停'))),
        error || message || directory === undefined || adding || (directory && !accounts.length) || expanded ? h('div', { className: 'ag-rail-drawer', role: 'region', 'aria-label': '账号管理与任务概览', tabIndex: 0 },
        error ? h('div', { className: 'ag-rail-note' }, h('div', { className: 'ag-err', role: 'alert' }, error,
          directory === undefined ? h('button', { className: 'ag-b sm', onClick: loadAccounts }, '重新读取账号') : null)) : null,
        message ? h('div', { className: 'ag-rail-note' }, h('div', { className: 'ag-ok', role: 'status' }, message)) : null,
        directory === undefined && !error ? h('div', { className: 'ag-rail-note' }, h('div', { className: 'ag-empty' }, '读取账号列表…')) : null,
        adding || (directory && !accounts.length) ? h('div', { className: 'ag-rail-note' }, h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
          h('div', { className: 'ag-form-title' }, '添加独立阅卷连接'),
          h('div', { className: 'ag-row' }, ['base', 'username', 'password', 'name'].map((key) => h('div', { key, className: 'ag-field', style: { flex: '1 1 160px' } },
            h('label', { htmlFor: 'ag-add-' + key }, { base: '阅卷地址', username: '账号', password: '密码', name: '账号简称（可选）' }[key]),
            h('input', { id: 'ag-add-' + key, value: form[key] || '', type: key === 'password' ? 'password' : 'text', onChange: (e) => setForm({ ...form, [key]: e.target.value }) })))),
          h('div', { className: 'ag-row', style: { marginTop: 12, alignItems: 'center' } },
            h('button', { className: 'ag-b pri', disabled: !!busy || !form.base || !form.username || !form.password, onClick: addAccount }, busy === 'accounts' ? '正在连接…' : '连接新账号'),
            h('span', { className: 'ag-hint' }, '新账号独立登录，不影响其他账号的运行任务。'))))) : null,
        expanded ? h('div', { className: 'ag-rail-note' },
          h('div', { className: 'ag-task-head' },
            h('span', null, '全部账号与任务'),
            h('span', { className: 'ag-hint' }, `模型并发上限 ${directory?.maxConcurrentModels || '—'} 路 · 切换查看不影响后台任务`)),
          h('div', { className: 'ag-tasks', 'data-testid': 'parallel-tasks' }, accounts.map((a) => {
            const task = a.autoMark || {}, active = ['running', 'stopping'].includes(task.status) || task.inFlight
            return h('div', { key: a.accountId, className: 'ag-task' + (a.accountId === selected ? ' sel' : ''), 'data-account-id': a.accountId },
              h('div', { className: 'ag-task-top' },
                h('div', { className: 'ag-task-id' },
                  h('b', null, a.name || a.username || a.accountId),
                  a.isDefault ? h('span', { className: 'ag-tag m' }, '默认') : null,
                  active ? h('span', { className: 'ag-task-flag live' }, '运行中') : attention(a) ? h('span', { className: 'ag-task-flag warn' }, '需处理') : null),
                h('span', { className: 'ag-task-state ' + (attention(a) ? 'bad' : active ? 'live' : 'idle'), title: statusLabel(a) }, statusLabel(a))),
              h('div', { className: 'ag-task-meta' },
                [a.base, task.selection?.question ? '第 ' + task.selection.question + ' 题' : '', modelLabel(task.model || a.job?.model)].filter(Boolean).join(' · ')),
              h('div', { className: 'ag-task-nums' },
                h('span', null, `已提交 ${task.submitted || 0} 份`),
                h('span', { className: task.review ? 'strong' : '' }, '需复核 ', h('b', null, task.review || 0)),
                h('span', { className: task.failed ? 'bad' : '' }, '失败 ', h('b', null, task.failed || 0)),
                task.inFlight ? h('span', { className: 'live' }, '请求未结束') : null,
                task.lastCostSec != null ? h('span', null, '上份耗时 ', h('b', null, task.lastCostSec + 's')) : null),
              h('div', { className: 'ag-task-ops' },
                a.accountId === selected ? h('span', { className: 'ag-tag b' }, '查看中') : h('button', { className: 'ag-b sm', onClick: () => choose(a.accountId) }, '切换查看'),
                h('button', { className: 'ag-b sm', disabled: !!busy || task.status !== 'running' || !a.taskId, onClick: () => control(a, 'marking-auto-pause') }, '暂停'),
                h('button', { className: 'ag-b sm', disabled: !!busy || active || a.recovery?.pending || task.submissionUncertain || !['paused', 'stopped'].includes(task.status) || !a.taskId, onClick: () => control(a, 'marking-auto-resume') }, '继续'),
                h('button', { className: 'ag-b sm danger', disabled: !!busy || !['running', 'stopping', 'paused'].includes(task.status) || !a.taskId, onClick: () => control(a, 'marking-auto-stop') }, '停止')))
          }))) : null) : null,
        h('div', { className: 'ag-rail-body' }, selected ? h(Workbench, { key: selected, accountId: selected, refresh, onAccountConnected: (id) => { choose(id); loadAccounts(true) } }) : h('div', { className: 'ag-rail-note' }, h('div', { className: 'ag-empty' }, '添加一个阅卷账号开始使用。'))))
    }

    function Workbench({ accountId = null, refresh = 0, onAccountConnected } = {}) {
      const draftKey = (field) => accountId ? 'ameqp-grading:' + encodeURIComponent(accountId) + ':' + field : 'ameqp-grading-' + field
      const [state, setState] = useState(null)
      const [settingsSection, setSettingsSection] = useState(() => {
        const saved = readDraft(draftKey('settingsSection'))
        return ['rubric', 'prompt', 'model', 'trial', 'general'].includes(saved) ? saved : 'rubric'
      })
      const loginPending = useRef(false)
      // Every handler closes over the account and task that rendered it. A late reply
      // may finish for that account, but can never route a follow-up to another view.
      const postJson = async (op, body) => {
        try { return await requestJson(accountPath(accountId, op), { ...(body || {}), ...(state?.taskId && taskOperation(op) ? { taskId: state.taskId } : {}) }) }
        finally {
          if (!['question-config', 'llm-models', 'review-get'].includes(op)) {
            loadGeneration.current++; loadPending.current?.controller.abort(); loadPending.current = null
          }
        }
      }
      const [error, setError] = useState('')
      const [connectionError, setConnectionError] = useState('')
      const [connecting, setConnecting] = useState(false)
      const [notice, setNotice] = useState('')
      const [startError, setStartError] = useState('')
      const [busy, setBusy] = useState('')
      const [page, setPage] = useState(() => readDraft(draftKey('page')) || 'work')
      const [loginTrialOpen, setLoginTrialOpen] = useState(false)
      const [draftError, setDraftError] = useState('')
      const draftFailures = useRef(new Set())
      const persistDraft = (key, value, message) => {
        try {
          writeDraft(key, value)
          draftFailures.current.delete(key)
        } catch { draftFailures.current.add(key) }
        setDraftError(draftFailures.current.size ? message : '')
      }
      const [login, setLogin] = useState(() => {
        try { const saved = JSON.parse(localStorage.getItem('ameqp-grading-login') || '{}'); return { name: '', base: saved.base || '', username: saved.username || '', password: saved.password || '' } }
        catch { return { name: '', base: '', username: '', password: '' } }
      })
      const [modelMode, setModelMode] = useState(() => { try { return JSON.parse(readDraft(draftKey('modelDraft')) || 'null')?.mode || 'harness' } catch { return 'harness' } })
      const [modelForm, setModelForm] = useState(() => { try { return JSON.parse(readDraft(draftKey('modelDraft')) || 'null')?.form || { provider: '', model: '', base_url: 'https://api.openai.com/v1', api_key: '', grading_effort: 'low' } } catch { return { provider: '', model: '', base_url: 'https://api.openai.com/v1', api_key: '', grading_effort: 'low' } } })
      const [llmProviders, setLlmProviders] = useState(null) // null=未加载；[{provider,name,models[]}]
      const [promptText, setPromptText] = useState(() => readDraft(draftKey('promptText')) || '')
      const [config, setConfig] = useState(null)
      const [generationFeedback, setGenerationFeedback] = useState(null)
      const [configForm, setConfigForm] = useState(() => {
        try { return JSON.parse(readDraft(draftKey('configForm')) || 'null') || { question: '', question_prompt: '', criteria: '', grading_method: 'rubric', question_type: 'design', extra_line_penalty: 0 } }
        catch { return { question: '', question_prompt: '', criteria: '', grading_method: 'rubric', question_type: 'design', extra_line_penalty: 0 } }
      })
      const [stemImage, setStemImage] = useState(() => readDraft(draftKey('stemImage')) || null)
      const [refImage, setRefImage] = useState(() => readDraft(draftKey('refImage')) || null)
      const [selectedQuestion, setSelectedQuestion] = useState(() => readDraft(draftKey('selectedQuestion')) || '')
      const [paper, setPaper] = useState(null)               // { paper_id, index, total, images[], max_score, criteria, ... }
      const [paperIndex, setPaperIndex] = useState(0)
      const [scores, setScores] = useState({})
      const [finalScore, setFinalScore] = useState('')
      const [notes, setNotes] = useState('')
      // 正式阅卷状态（productionMarking=true 时可用）
      const [mark, setMark] = useState(null)                 // { ansQueSN, ansStuSN, ansMultiMethod, ansQueMarkState, marIsTryMark, points[], images[] }
      const [markScore, setMarkScore] = useState('')
      const pollRef = useRef(null)
      const configLoadSeq = useRef(0)
      const configBaseline = useRef('')
      const pasteTargetRef = useRef(null)
      const scrollRef = useRef(null)
      const flashTimer = useRef(null)
      const loadPending = useRef(null)
      const loadGeneration = useRef(0)
      const mounted = useRef(true)

      const load = useCallback(() => {
        if (!mounted.current) return Promise.resolve()
        if (loadPending.current) return loadPending.current.promise
        const generation = ++loadGeneration.current
        const entry = { controller: new AbortController() }
        loadPending.current = entry
        entry.promise = (async () => {
          setConnecting(true)
          try {
            const next = await getState(accountId, entry.controller.signal)
            if (mounted.current && generation === loadGeneration.current) { setState(next); setConnectionError('') }
          } catch (e) {
            if (mounted.current && generation === loadGeneration.current) setConnectionError('无法连接后端：' + (e && e.message ? e.message : String(e)))
          } finally {
            if (loadPending.current === entry) loadPending.current = null
            if (mounted.current && generation === loadGeneration.current) setConnecting(false)
          }
        })()
        return entry.promise
      }, [accountId])
      useEffect(() => {
        mounted.current = true
        load()
        return () => { mounted.current = false; loadGeneration.current++; configLoadSeq.current++; loadPending.current?.controller.abort(); loadPending.current = null }
      }, [load])
      useEffect(() => { if (refresh) load() }, [refresh, load])
      useEffect(() => {
        if (!connectionError) return
        let disposed = false
        let timer
        const retry = async () => {
          await load()
          if (!disposed) timer = setTimeout(retry, 5000)
        }
        timer = setTimeout(retry, 3000)
        window.addEventListener('online', load)
        return () => { disposed = true; clearTimeout(timer); window.removeEventListener('online', load) }
      }, [connectionError, load])

      // Account-scoped page/model drafts and selection-scoped configuration include
      // the full images. Quota failures retain memory and explicitly ask for a save.
      useEffect(() => {
        if (!state || !initKeyRef.current) return
        const warning = '浏览器草稿空间不足；编辑内容暂存于当前窗口，请保存到后端后再关闭页面。'
        persistDraft(draftKey('page'), page, warning)
        persistDraft(draftKey('settingsSection'), settingsSection, warning)
        persistDraft(draftKey('selectedQuestion'), selectedQuestion || '', warning)
        persistDraft(draftKey('promptText'), promptText, warning)
        persistDraft(draftKey('modelDraft'), JSON.stringify({ mode: modelMode, form: modelForm }), warning)
      }, [state?.username, page, settingsSection, selectedQuestion, promptText, modelMode, modelForm])
      useEffect(() => {
        if (!state || !configForm.selection_key) return
        const key = configForm.selection_key
        // Never attach an old selection's form to the next selection's images.
        if (key !== `${state.exam}:${state.subject}:${Number(selectedQuestion || state.question)}`) return
        const dirty = JSON.stringify({ configForm, stemImage, refImage }) !== configBaseline.current
        const data = JSON.stringify({ configForm, config, stemImage, refImage, dirty })
        persistDraft(draftKey('selection:' + key), data, '图片或配置草稿未能持久保存：浏览器空间不足。图片仍保留在本窗口，请点击「保存本题配置」后再关闭页面。')
      }, [configForm, config, stemImage, refImage, state?.exam, state?.subject, selectedQuestion])

      const flash = useCallback((msg, isErr) => {
        if (!mounted.current) return
        if (isErr) { setError(msg); setNotice('') } else { setNotice(msg); setError('') }
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => { setNotice(''); setError('') }, 5000)
      }, [])

      const act = useCallback(async (op, body, okMsg) => {
        setBusy(op)
        try {
          const r = await postJson(op, body)
          await load()
          if (okMsg) flash(okMsg)
          return r
        } catch (e) { await load(); flash('操作失败：' + (e && e.message ? e.message : String(e)), true); return null }
        finally { setBusy('') }
      }, [load, flash, state?.taskId])

      // 仅在首次拿到 state / 切换账号时初始化表单，避免轮询刷新覆盖用户正在编辑的内容
      const initKeyRef = useRef('')
      useEffect(() => {
        if (!state) return
        const key = `${state.username || ''}|${state.connected ? '1' : '0'}`
        if (initKeyRef.current === key) return
        initKeyRef.current = key
        setLogin((v) => accountId
          ? { ...v, base: state.base || state.defaultBase || '', username: state.username || '', password: v.username === state.username && v.base === (state.base || state.defaultBase) ? v.password : '' }
          : { ...v, base: v.base || state.defaultBase || '' })
        // 有未保存草稿时优先保留草稿，不覆盖
        const hasDraft = readDraft(draftKey('promptText')) != null
        if (state.prompt != null && !hasDraft) setPromptText(state.prompt)
        if (state.model && !readDraft(draftKey('modelDraft'))) { setModelMode(state.model.mode); setModelForm((v) => ({ ...v, provider: state.model.provider || '', model: state.model.model || '', base_url: state.model.base_url || v.base_url, grading_effort: state.model.grading_effort || 'low' })) }
      }, [state])

      const job = state && state.job
      const running = job && ['running', 'stopping'].includes(job.status)
      const autoMark = state && state.autoMark
      const autoRunning = autoMark && ['running', 'stopping'].includes(autoMark.status)
      const autoBusy = autoRunning || !!autoMark?.inFlight
      useEffect(() => {
        if (!running && !autoBusy && !accountId) return
        let disposed = false
        const interval = () => document.hidden ? 5000 : autoBusy ? 600 : running ? 1200 : 1800
        const tick = async () => {
          await load()
          if (!disposed) pollRef.current = setTimeout(tick, interval())
        }
        pollRef.current = setTimeout(tick, interval())
        return () => {
          disposed = true
          if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
        }
      }, [running, autoBusy, load])
      useEffect(() => { setMark(state?.manualMark || null) }, [state?.manualMark])

      // 卸载时清理提示定时器，避免 setState 到已卸载组件
      useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

      // 进入设置页时加载 DSH 模型列表（必须在所有条件 return 之前注册）
      useEffect(() => {
        if (page !== 'settings' || llmProviders != null) return
        let cancelled = false
        ;(async () => {
          try {
            const r = await postJson('llm-models', {})
            if (!cancelled) setLlmProviders(r.providers || [])
          } catch (e) {
            if (!cancelled) setLlmProviders([])
          }
        })()
        return () => { cancelled = true }
      }, [page, llmProviders])

      // 粘贴图片：监听 paste 事件，把剪贴板里的图片转成 dataURL
      useEffect(() => {
        const el = document.body
        const onPaste = (e) => {
          const t = pasteTargetRef.current
          if (!t) return
          const items = e.clipboardData && e.clipboardData.items
          if (!items) return
          for (const it of items) {
            if (it.type && it.type.startsWith('image/')) {
              const file = it.getAsFile()
              if (!file) continue
              e.preventDefault()
              if (file.size > 2 * 1024 * 1024) { flash('图片请控制在2MB以内', true); return }
              const r = new FileReader()
              const sequence = configLoadSeq.current
              r.onload = () => { if (mounted.current && sequence === configLoadSeq.current) t.cb(r.result) }
              r.readAsDataURL(file)
              return
            }
          }
        }
        el.addEventListener('paste', onPaste)
        return () => el.removeEventListener('paste', onPaste)
      }, [flash])

      useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = page === 'settings' ? 0 : Number(readDraft(draftKey('scroll:' + page))) || 0
      }, [page, settingsSection, state?.connected])
      const rememberScroll = (event) => {
        try { writeDraft(draftKey('scroll:' + page), String(event.currentTarget.scrollTop)) } catch { /* View position remains in memory. */ }
      }
      const restoredSelection = useRef('')
      useEffect(() => {
        if (!state?.connected || page !== 'settings') return
        const question = Number(selectedQuestion || state.question)
        if (!question || !(state.questions || []).some((q) => Number(q.id) === question)) return
        const key = `${state.exam}:${state.subject}:${question}`
        if (restoredSelection.current === key) return
        restoredSelection.current = key
        fetchConfig(state.exam, state.subject, question).catch((e) => { if (mounted.current) { restoredSelection.current = ''; flash('读取题目配置失败：' + e.message, true) } })
      }, [state?.connected, state?.exam, state?.subject, state?.question, selectedQuestion, page])

      if (!state) {
        return h('div', { className: 'ag-page' }, h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'ag-in' }, h('div', { className: 'ag-card' }, h('div', { className: 'ag-empty' },
            connectionError
              ? h('div', null, h('div', { role: 'alert', style: { marginBottom: 12 } }, connectionError),
                  h('button', { className: 'ag-b', disabled: connecting, onClick: load }, connecting ? '正在重试…' : '重新连接'),
                  h('div', { style: { marginTop: 8, fontSize: 11 } }, '页面会自动重试；不会启动或提交阅卷。'))
              : h('span', null, h('span', { className: 'ag-spin' }), ' 连接中…')))))
      }

      const model = state.model
      const candidateQid = Number(selectedQuestion || state.question)
      const qid = Array.isArray(state.questions) && state.questions.some((q) => Number(q.id) === candidateQid) ? candidateQid : 0
      const pendingAuto = !!autoMark?.current && !autoMark.current.submitted
      const recoveryPending = !!state.recovery?.pending
      const selectionLocked = running || autoBusy || pendingAuto || !!mark || !!state.manualMark || recoveryPending
      const connectionNotice = h(React.Fragment, null,
        recoveryPending ? h(RecoveryResolution, { key: String(state.recovery.claim?.ansQueSN ?? 'unknown'), recovery: state.recovery, blocked: !!busy || autoBusy || running,
          onResolve: (resolution, note) => act('recovery-resolve', { ansQueSN: state.recovery.claim?.ansQueSN ?? null, resolution, note }, '恢复记录已确认，请按需重新启动任务') }) : null,
        draftError ? h('div', { className: 'ag-err', role: 'alert' }, draftError) : null,
        connectionError ? h('div', { className: 'ag-err', role: 'alert' }, connectionError,
          h('button', { className: 'ag-b sm', disabled: connecting, onClick: load, style: { marginLeft: 10 } }, connecting ? '正在重试…' : '重新连接')) : null)
      function setLoadedConfig(c) {
        const form = { question: c.question || '', question_prompt: c.question_prompt || '', teacher_standard: c.teacher_standard || '', criteria: JSON.stringify(c.criteria || [], null, 2), grading_method: c.grading_method || 'rubric', question_type: c.question_type || 'design', extra_line_penalty: c.extra_line_penalty || 0, selection_key: `${c.exam}:${c.subject}:${c.question_id}` }
        configBaseline.current = JSON.stringify({ configForm: form, stemImage: c.stem_image || null, refImage: c.reference_image || null })
        setConfig(c); setConfigForm(form)
        setStemImage(c.stem_image || null); setRefImage(c.reference_image || null); setGenerationFeedback(null)
      }
      async function fetchConfig(exam, subject, question, useDraft = true) {
        const sequence = ++configLoadSeq.current
        const key = `${exam}:${subject}:${Number(question)}`
        let draft = null
        if (useDraft) { try { draft = JSON.parse(readDraft(draftKey('selection:' + key)) || 'null') } catch { /* backend fallback */ } }
        if (draft?.configForm?.selection_key === key && draft.dirty !== false) {
          setConfig(draft.config || null); setConfigForm(draft.configForm)
          setStemImage(draft.stemImage || null); setRefImage(draft.refImage || null); setGenerationFeedback(null)
          return
        }
        const c = await postJson('question-config', { exam: Number(exam), subject: Number(subject), question: Number(question) })
        if (mounted.current && sequence === configLoadSeq.current) setLoadedConfig(c)
      }
      function assertDraftSelection() {
        if (!qid || configForm.selection_key !== `${state.exam}:${state.subject}:${qid}`) throw new Error('请先载入当前题目配置，避免把其他题目的草稿保存到本题')
      }

      /* ---------------- 登录页 ---------------- */
      if (!state.connected) {
        const doLogin = async () => {
          if (loginPending.current || busy === 'login' || !login.username.trim() || !login.password) return
          loginPending.current = true
          setBusy('login'); setError('')
          const submitted = { ...login, username: login.username.trim() }
          try {
            let targetId = accountId, target
            if (accountId) {
              const directory = await getAccounts()
              // Match the same normalized site/user pair as the Host. Never redirect
              // other task operations or replace an account's saved identity.
              const canonical = (base) => { const url = new URL(String(base).trim()); url.pathname = url.pathname.replace(/\/+$/, '') + '/'; return url.href }
              const base = canonical(submitted.base || state.base || state.defaultBase)
              target = directory?.accounts.find((a) => String(a.username || '').trim() === submitted.username && canonical(a.base) === base)
              if (target) targetId = target.accountId
              if (!mounted.current) return
            }
            if (!target?.connected) await requestJson(accountPath(targetId, 'login'), submitted)
            if (!mounted.current) return
            if (!target?.connected) {
              try { localStorage.setItem('ameqp-grading-login', JSON.stringify({ base: submitted.base, username: submitted.username, password: submitted.password })) } catch { /* existing local credential semantics */ }
            }
            if (targetId !== accountId && onAccountConnected) {
              onAccountConnected(targetId)
              return
            }
            loadGeneration.current++; loadPending.current?.controller.abort(); loadPending.current = null
            await load()
            if (mounted.current) setPage('work')
          } catch (e) {
            if (mounted.current) flash('登录失败：' + (e?.message || String(e)), true)
          } finally {
            loginPending.current = false
            if (mounted.current) setBusy('')
          }
        }
        return h('div', { className: 'ag-page' }, h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'ag-scroll ag-login-backdrop' }, h('div', { className: 'ag-login' },
            h('div', { className: 'ag-login-card' },
              h('div', { className: 'ag-login-hero' },
                h('div', { className: 'ag-login-brand-mark', 'aria-hidden': true }, h(Icon, { size: 22 })),
                h('h1', null, 'AMEQP 阅卷')),
              h('div', { className: 'ag-login-form' },
                connectionNotice,
                error ? h('div', { className: 'ag-err', style: { marginBottom: 0 }, role: 'alert' }, error) : null,
                h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-login-base' }, '阅卷地址'), h('input', { id: 'ag-login-base', value: login.base, onChange: (e) => setLogin({ ...login, base: e.target.value }), spellCheck: false })),
                h('div', { className: 'ag-login-credentials' },
                  h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-login-username' }, '账号'), h('input', { id: 'ag-login-username', value: login.username, onChange: (e) => setLogin({ ...login, username: e.target.value }), autoComplete: 'username' })),
                  h('div', { className: 'ag-field' }, h('label', { htmlFor: 'ag-login-password' }, '密码'), h('input', { id: 'ag-login-password', type: 'password', value: login.password, onChange: (e) => setLogin({ ...login, password: e.target.value }), autoComplete: 'current-password', onKeyDown: (e) => { if (e.key === 'Enter') doLogin() } }))),
                h('div', { className: 'ag-login-actions' },
                  h('button', { className: 'ag-b pri', onClick: doLogin, disabled: busy === 'login' || !login.username || !login.password }, busy === 'login' ? h('span', { className: 'ag-spin' }) : null, '登录')),
              )),
            h('div', { className: 'ag-login-trial' },
              h('button', { className: 'ag-b ghost', 'aria-expanded': loginTrialOpen, 'aria-controls': 'ag-login-decisions', onClick: () => setLoginTrialOpen((open) => !open) }, 'Decisions 试验'),
              loginTrialOpen ? h('div', { id: 'ag-login-decisions' }, h(DecisionsTrial, { postJson, sampleOnly: true })) : null))))
      }

      /* ---------------- header ---------------- */
      const header = h('div', { className: 'ag-head' },
        h('div', { className: 'ag-who' },
          h('h1', { className: 'ag-page-title' }, page === 'settings' ? '阅卷设置' : '阅卷工作台'),
          h('div', { className: 'ag-who-meta' },
            h('span', { className: 'ag-who-name' }, state.name || state.username || 'AI 阅卷'),
            h('span', { className: 'ag-tag ' + (state.productionMarking ? 'g' : 'm') }, state.productionMarking ? '正式阅卷' : '只读试评'),
            h('span', { className: 'ag-who-host', title: state.base || '' }, state.base || ''))),
        h('div', { className: 'ag-head-right' },
          h('div', { className: 'ag-seg' },
            h('button', { className: page === 'work' ? 'on' : '', onClick: () => setPage('work') }, '自动阅卷'),
            h('button', { className: page === 'settings' ? 'on' : '', onClick: () => setPage('settings') }, '设置')),
          h('button', { className: 'ag-b sm ghost danger', onClick: () => act('disconnect', {}, null), disabled: running || autoBusy }, '断开连接'),
        ),
      )

      /* 选择器（共用） */
      const selector = h('div', { className: 'ag-card ag-selector' },
        h('div', { className: 'ag-body' },
          h('div', { className: 'ag-row' },
            h('div', { className: 'ag-field', style: { flex: '2 1 260px' } }, h('label', null, '考试'), h('select', {
              value: state.exam, disabled: selectionLocked,
              onChange: async (e) => {
                const v = e.target.value
                setStartError('')
                configLoadSeq.current++; setSelectedQuestion(''); setConfig(null); setGenerationFeedback(null)
                setPaper(null); setMark(null); setScores({}); setFinalScore(''); setMarkScore('')
                if (!v) return
                setBusy('subjects')
                try { await postJson('subjects', { exam: v }); await load() } catch (er) { flash(er.message, true) } finally { setBusy('') }
              },
            }, h('option', { value: '' }, '请选择考试'), (state.exams || []).map((x) => h('option', { key: x.id, value: String(x.id) }, `${x.name}${x.date ? '  [' + x.date + ']' : ''}${x.is_finish === false ? '（进行中）' : ''}`)))),
            h('div', { className: 'ag-field', style: { flex: '1 1 170px' } }, h('label', null, '科目'), h('select', {
              value: state.subject, disabled: selectionLocked || !state.exam,
              onChange: async (e) => {
                const v = e.target.value
                setStartError('')
                configLoadSeq.current++; setSelectedQuestion(''); setGenerationFeedback(null)
                setPaper(null); setMark(null); setConfig(null)
                if (!v) return
                setBusy('questions')
                try { await postJson('questions', { exam: Number(state.exam), subject: v }); await load() } catch (er) { flash(er.message, true) } finally { setBusy('') }
              },
            }, h('option', { value: '' }, '请选择科目'), (state.subjects || []).map((x) => h('option', { key: x.id, value: String(x.id) }, x.name)))),
            h('div', { className: 'ag-field', style: { flex: '2 1 230px' } }, h('label', null, '题目'), h('select', {
              value: qid ? String(qid) : '', disabled: selectionLocked || !state.subject,
              onChange: async (e) => {
                const v = e.target.value
                setStartError('')
                configLoadSeq.current++
                setSelectedQuestion(v)
                setPaper(null); setMark(null); setScores({}); setFinalScore(''); setMarkScore(''); setConfig(null)
                if (!v) return
                setBusy('config')
                try { await fetchConfig(state.exam, state.subject, v); await load() } catch (er) { flash(er.message, true) } finally { setBusy('') }
              },
            }, h('option', { value: '' }, '请选择题号'), (state.questions || []).map((x) => h('option', { key: x.id, value: String(x.id) }, x.max_score ? `${x.name}（满分 ${x.max_score}）` : x.name)))),
          )))

      /* ---------------- 阅卷工作台 ---------------- */
      if (page === 'work') {
        const jobStatus = job ? { running: '运行中', stopping: '正在停止', stopped: '已停止', completed: '批次结束', failed: '任务失败' }[job.status] || job.status : ''

        const loadPaper = async (idx) => {
          if (!qid) { flash('请选择题目', true); return }
          setBusy('paper')
          try {
            if (state.productionMarking) {
              // 正式阅卷：领卷（会占用答卷），返回当前题目的分割答卷图
              const m = await postJson('marking-get', { exam: Number(state.exam), subject: Number(state.subject), question: qid })
              setMark(m)
              setMarkScore(m.ansQueMarkValue != null ? String(m.ansQueMarkValue) : '')
            } else {
              // 只读模式：按索引读已完成考试的答卷
              const p = await postJson('paper-load', { exam: Number(state.exam), subject: Number(state.subject), question: qid, index: idx })
              setPaper(p); setPaperIndex(idx); setFinalScore(''); setNotes('')
              setScores(Object.fromEntries((p.criteria || []).map((c) => [c.id, ''])))
              const rv = await postJson('review-get', { exam: Number(state.exam), subject: Number(state.subject), question: qid, index: idx })
              if (rv) { setScores(rv.scores || {}); if (rv.final_score_override != null) setFinalScore(String(rv.final_score_override)); setNotes(rv.notes || '') }
            }
          } catch (e) { flash(e.message, true) } finally { if (state.productionMarking) await load(); setBusy('') }
        }

        const saveReview = async () => {
          if (state.productionMarking) {
            // 正式阅卷：提交评分并自动领下一份
            if (!mark) { flash('请先领一份答卷', true); return }
            if (markScore === '') { flash('请先给分', true); return }
            const savedId = '答卷 ' + mark.ansQueSN
            setBusy('marking-submit')
            try {
              await postJson('marking-submit', { exam: Number(state.exam), subject: Number(state.subject), question: qid, ansQueSN: mark.ansQueSN, ansMultiMethod: mark.ansMultiMethod, ansQueMarkState: mark.ansQueMarkState, marIsTryMark: mark.marIsTryMark, value: Number(markScore), points: [] })
              setMark(null); setMarkScore('')
              // 自动领下一份
              const m = await postJson('marking-get', { exam: Number(state.exam), subject: Number(state.subject), question: qid })
              setMark(m); setMarkScore(m.ansQueMarkValue != null ? String(m.ansQueMarkValue) : '')
              flash('已提交 ' + savedId + ' 评分，已领下一份')
            } catch (e) { flash(e.message, true) } finally { await load(); setBusy('') }
            return
          }
          // 只读：本地保存并自动切下一份
          if (!paper) { flash('请先加载答卷', true); return }
          const savedId = paper.paper_id
          const body = { exam: Number(state.exam), subject: Number(state.subject), question: qid, index: paperIndex, scores, notes, final_score_override: finalScore === '' ? null : Number(finalScore) }
          await act('save-review', body, null)
          if (paperIndex < paper.total - 1) {
            await loadPaper(paperIndex + 1)
            flash('已保存 ' + savedId + ' 评分，已进入下一份')
          } else {
            flash('已保存 ' + savedId + ' 评分，本题队列已完成')
          }
        }

        const computedFinal = (() => {
          const sum = (paper?.criteria || []).reduce((a, c) => a + (Number(scores[c.id]) || 0), 0)
          return Math.max(0, Math.round(sum * 100) / 100)
        })()

        return h('div', { className: 'ag-page' }, h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'ag-scroll', ref: scrollRef, onScroll: rememberScroll }, h('div', { className: 'ag-in' },
            header,
            connectionNotice,
            error ? h('div', { className: 'ag-err' }, error) : null,
            notice ? h('div', { className: 'ag-ok' }, notice) : null,

            h('div', { className: 'ag-sec' }, '阅卷项目'), selector,

            h('div', { className: 'ag-sec' }, '当前答卷',
              qid ? h('span', { className: 'ag-tag m' }, '题目 ' + qid) : h('span', { className: 'ag-tag w' }, '未选择题号'),
              autoRunning ? h('span', { className: 'ag-tag b' }, 'AI 自动阅卷中') : null),
            startError ? h('div', { className: 'ag-err', role: 'alert' }, 'AI 阅卷未启动：' + startError) : null,
            // 正式阅卷（productionMarking=true）：AI 运行中显示 autoMark 视图，否则显示手工领卷视图
            state.productionMarking
              ? (autoMark && !mark && (autoBusy || autoMark.current || autoMark.stream?.text || ['paused', 'failed', 'completed'].includes(autoMark.status))
                  ? h('div', { className: 'ag-mark', style: !autoMark.current?.images?.length ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined },
                      autoMark.current?.images?.length ? h('div', { className: 'ag-paper' },
                        h('div', { className: 'ag-paper-label' }, h('span', null, '密号'), h('span', null, autoMark.current.stuSecNo || '未提供')),
                        h('div', { className: 'ag-paper-img' }, autoMark.current.images.map((src, i) => h('img', { key: i, src, alt: '当前答卷', style: autoMark.current.images.length > 1 ? { maxWidth: '48%', margin: 6 } : null })))) : null,
                      h('div', { className: 'ag-g' },
                        h('div', { className: 'ag-card' },
                          h('div', { className: 'ag-body' },
                            autoMark.status === 'paused' && autoMark.phase ? h('div', { className: 'ag-err', style: { marginBottom: 10 } }, autoMark.phase) : null,
                             autoMark.submissionUncertain ? h('div', { className: 'ag-err', role: 'alert' }, '提交结果未确认，请先在原系统核对；当前任务不会继续领卷或重复提交。') : null,
                            h('div', { className: 'ag-run' },
                              h('div', { className: 'ag-run-head' },
                                h('span', { className: 'ag-run-phase' }, autoBusy ? h('span', { className: 'ag-spin' }) : null, ' ' + (autoMark.phase || autoMark.status)),
                                h('span', { className: 'ag-run-model', title: modelLabel(autoMark.model || state.model) }, '模型 ' + modelLabel(autoMark.model || state.model))),
                              h('div', { className: 'ag-stats' },
                                h('div', { className: 'ag-stat' }, h('b', null, autoMark.submitted || 0), h('span', null, '已提交份数')),
                                h('div', { className: 'ag-stat' }, h('b', null, `${autoMark.review || 0}`), h('span', null, '份需复核')),
                                autoMark.batchLimit ? h('div', { className: 'ag-stat' }, h('b', null, `${autoMark.batchSubmitted || 0}/${autoMark.batchLimit}`), h('span', null, `本批 第${autoMark.batchNumber || 1}批`)) : null,
                                autoMark.lastCostSec ? h('div', { className: 'ag-stat' }, h('b', null, autoMark.lastCostSec + 's'), h('span', null, '上份耗时')) : null)),
                            (autoMark.tClaimMs != null || autoMark.tImgMs != null || autoMark.tSubmitMs != null || autoMark.tModelMs != null)
                              ? h('details', { className: 'ag-detail' },
                                  h('summary', null, '耗时明细'),
                                  h('div', { className: 'ag-detail-body' },
                                    h('span', null, `领卷 ${autoMark.tClaimMs || 0}ms · 取图 ${autoMark.tImgMs || 0}ms · 提交 ${autoMark.tSubmitMs || 0}ms`),
                                    autoMark.tModelMs != null ? h('span', null, `附件 ${autoMark.tAttachmentMs || 0}ms · 模型 ${(autoMark.tModelMs / 1000).toFixed(1)}s · 推理 ${autoMark.reasoningEffort === 'low' ? 'low' : '模型默认'}`) : null)) : null,
                            autoMark.current && autoMark.current.score != null ? h('div', { style: { marginBottom: 10 } },
                              h('span', { className: 'ag-tag ' + (autoMark.current.needs_human_review ? 'w' : 'g') }, autoMark.current.needs_human_review ? '需人工复核' : 'AI 建议分'),
                              h('div', { className: 'ag-score-num' }, h('b', { style: { fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, autoMark.current.score + ' 分'))) : null,

                            pendingAuto && ['paused', 'stopped'].includes(autoMark.status) ? h(ManualResolution, {
                              key: autoMark.current.ansQueSN, claim: autoMark.current, postJson, selection: autoMark.selection || { exam: Number(state.exam), subject: Number(state.subject), question: qid },
                              maxScore: Number(autoMark.current.max_score || (state.questions || []).find((q) => Number(q.id) === Number(autoMark.selection?.question || qid))?.max_score),
                              blocked: recoveryPending || !!autoMark.inFlight || !!autoMark.submissionUncertain || !!autoMark.current.submissionUncertain,
                              onResolved: async (message, isError = false) => { await load(); flash(message, isError) },
                            }) : null,
                            ['paused', 'stopped'].includes(autoMark.status) ? h('div', { className: 'ag-row', style: { marginBottom: 10 } },
                              h('button', { className: 'ag-b pri', disabled: recoveryPending || !!autoMark.inFlight || !!autoMark.submissionUncertain || (pendingAuto && !!autoMark.current?.needs_human_review) || busy === 'marking-auto-resume', onClick: async () => { setBusy('marking-auto-resume'); try { await postJson('marking-auto-resume', {}); await load(); flash('已继续') } catch (e) { flash(e.message, true) } finally { setBusy('') } } }, autoMark.pauseReason === 'batch_limit' ? `继续下一批（${autoMark.batchLimit}份）` : '继续 AI 阅卷'),
                            ) : null,
                            h('div', { className: 'ag-row' },
                              h('button', { className: 'ag-b', onClick: async () => { setBusy('marking-auto-pause'); try { await postJson('marking-auto-pause', {}); await load(); flash('已请求暂停；请等待在途请求或提交确认') } catch (e) { flash(e.message, true) } finally { setBusy('') } }, disabled: !['running'].includes(autoMark.status) }, '暂停'),
                              h('button', { className: 'ag-b', onClick: async () => { setBusy('marking-auto-stop'); try { await postJson('marking-auto-stop', {}); await load(); flash('已请求停止；请等待在途请求或提交确认') } catch (e) { flash(e.message, true) } finally { setBusy('') } }, disabled: !['running', 'stopping', 'paused'].includes(autoMark.status) }, '停止'),
                            )))))
                  : (mark
                      ? h('div', { className: 'ag-mark' },
                          h('div', { className: 'ag-paper' },
                            h('div', { className: 'ag-paper-label' }, h('span', null, '密号'), h('span', null, mark.stuSecNo || '未提供')),
                            h('div', { className: 'ag-paper-img' }, (mark.images || []).map((src, i) => h('img', { key: i, src, alt: '答卷', style: (mark.images || []).length > 1 ? { maxWidth: '48%', margin: 6 } : null })))),
                          h('div', { className: 'ag-g' },
                            h('div', { className: 'ag-card' },
                              h('div', { className: 'ag-body' },
                                h('div', { style: { fontSize: 11, color: 'var(--tm)', marginBottom: 8 } }, `答卷 ${mark.ansQueSN} · 评卷状态 ${mark.ansQueMarkState || '—'}${mark.ansQueMarkValue != null ? ' · 已有分 ' + mark.ansQueMarkValue : ''}`),
                                mark.submissionUncertain ? h('div', { className: 'ag-err' }, '提交结果未确认，请先在原系统核对，暂不可重复提交或取消。') : null,
                                h('div', { className: 'ag-field', style: { marginBottom: 12 } }, h('label', null, '本份分数'),
                                  h('div', { className: 'ag-score-num' }, h('input', { type: 'number', min: 0, value: markScore, onChange: (e) => setMarkScore(e.target.value), style: { fontSize: 22, fontWeight: 680, textAlign: 'center' } }))),
                                h('div', { className: 'ag-row' },
                                  h('button', { className: 'ag-b pri', disabled: busy === 'marking-submit' || markScore === '' || !!mark.submissionUncertain, onClick: saveReview }, busy === 'marking-submit' ? h('span', { className: 'ag-spin' }) : null, '提交并领下一份'),
                                  h('button', { className: 'ag-b', disabled: busy === 'marking-cancel' || !!mark.submissionUncertain, onClick: async () => {
                                    setBusy('marking-cancel')
                                    try { await postJson('marking-cancel', { exam: Number(state.exam), subject: Number(state.subject), question: qid, ansQueSN: mark.ansQueSN, ansQueMarkState: mark.ansQueMarkState, isReview: false, ansMultiMethod: mark.ansMultiMethod }); flash('已取消领卷'); setMark(null); setMarkScore('') }
                                    catch (e) { flash(e.message, true) } finally { setBusy('') }
                                  } }, '取消领卷'))))))
                      : h('div', { className: 'ag-card' }, h('div', { className: 'ag-empty ag-empty-paper' },
                          h(Icon, { size: 36 }), h('b', null, '等待答卷'), h('span', null, '选择题目后开始阅卷')))))
              : null,
            state.productionMarking && !mark && !autoBusy && !pendingAuto ? h('div', { className: 'ag-row ag-toolbar', style: { marginTop: 16 } },
              h('button', { className: 'ag-b', disabled: busy === 'marking-get' || !qid || recoveryPending, onClick: () => loadPaper(0) }, busy === 'marking-get' ? h('span', { className: 'ag-spin' }) : null, '领一份答卷'),
              h('button', { className: 'ag-b pri', disabled: busy === 'marking-auto-start' || !qid || !model || recoveryPending, onClick: async () => {
                  setBusy('marking-auto-start')
                  setStartError('')
                  try {
                    const next = await postJson('marking-auto-start', { exam: Number(state.exam), subject: Number(state.subject), question: qid })
                    setState(next)
                    await load()
                  } catch (e) { setStartError(e.message || String(e)); await load() } finally { setBusy('') }
                } }, busy === 'marking-auto-start' ? h('span', { className: 'ag-spin' }) : null, '启动 AI 逐份阅卷'),
              model ? null : h('span', { style: { fontSize: 11, color: 'var(--tm)', alignSelf: 'center' } }, '请先在设置页配置模型，才能启动 AI 阅卷。'),
            ) : null,

            // 只读视图（productionMarking=false）：本地试阅
            !state.productionMarking
              ? (paper
                  ? h('div', { className: 'ag-mark' },
                      h('div', { className: 'ag-paper' },
                        h('div', { className: 'ag-paper-img' }, (paper.images || []).map((src, i) => h('img', { key: i, src, alt: paper.paper_id + ' 第' + (i + 1) + '页', style: (paper.images || []).length > 1 ? { maxWidth: '48%', margin: 6 } : null }))),
                        h('div', { className: 'ag-nav' },
                          h('button', { className: 'ag-b sm', onClick: () => loadPaper(paperIndex - 1), disabled: paperIndex <= 0 || busy === 'paper' }, '← 上一份'),
                          h('span', { className: 'pos' }, `${paperIndex + 1} / ${paper.total}`),
                          h('button', { className: 'ag-b sm', onClick: () => loadPaper(paperIndex + 1), disabled: paperIndex >= paper.total - 1 || busy === 'paper' }, '下一份 →'))),
                      h('div', { className: 'ag-g' },
                        h('div', { className: 'ag-card' },
                          h('div', { className: 'ag-body' },
                            h('div', { style: { fontSize: 11, color: 'var(--tm)', marginBottom: 8 } }, `${paper.paper_id} · 满分 ${paper.max_score} 分`),
                            h('div', { className: 'ag-field', style: { marginBottom: 8 } }, h('label', null, '本份最终分'),
                              h('div', { className: 'ag-score-num' }, h('input', { type: 'number', min: 0, max: paper.max_score, step: 'any', value: finalScore, placeholder: '—', onChange: (e) => setFinalScore(e.target.value) }), h('span', null, '/ ' + paper.max_score))),
                            h('div', { className: 'ag-quick' }, Array.from({ length: paper.max_score + 1 }, (_, v) => h('button', { key: v, className: finalScore === String(v) ? 'on' : '', onClick: () => setFinalScore(String(v)) }, v))),
                            (paper.criteria || []).map((c) => h('div', { key: c.id, className: 'ag-crit' },
                              h('div', { className: 'd' }, c.description),
                              h('input', { type: 'number', min: 0, max: c.max_score, step: 'any', value: scores[c.id] ?? '', placeholder: '—', onChange: (e) => setScores({ ...scores, [c.id]: e.target.value }) }),
                              h('span', { style: { color: 'var(--tm)', fontSize: 11 } }, '/ ' + c.max_score))),
                            h('div', { style: { fontSize: 11, color: 'var(--tm)', margin: '8px 0' } }, '分项合计 ' + computedFinal + ' 分'),
                            h('div', { className: 'ag-field', style: { marginBottom: 12 } }, h('label', null, '评阅备注'), h('textarea', { rows: 2, value: notes, onChange: (e) => setNotes(e.target.value), placeholder: '扣分原因或疑难点…' })),
                            h('button', { className: 'ag-b pri', onClick: saveReview, disabled: busy === 'save-review' }, busy === 'save-review' ? h('span', { className: 'ag-spin' }) : null, '提交评分')))))
                  : h('div', { className: 'ag-card' }, h('div', { className: 'ag-empty' }, '选择题目后点「加载答卷」开始本地试阅。')))
              : null,
            !state.productionMarking && !paper ? h('div', { className: 'ag-row', style: { marginTop: 12 } },
              h('button', { className: 'ag-b', onClick: () => loadPaper(0), disabled: !qid || busy === 'paper' }, busy === 'paper' ? h('span', { className: 'ag-spin' }) : null, '加载答卷'),
            ) : null,

            job ? h('div', { className: 'ag-sec' }, '任务进度', h('span', { className: 'ag-tag ' + (job.status === 'failed' ? 'e' : job.status === 'completed' ? 'g' : 'b') }, jobStatus)) : null,
            job ? h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
              h('div', { style: { fontSize: 12, color: 'var(--tm)', marginBottom: 6 } }, `${job.title || ''} · ${job.phase || ''} · 模型 ${job.model || ''}`),
              h(StreamOutput, { stream: job.stream }),
              h('div', { className: 'ag-metrics' },
                h('div', { className: 'ag-metric' }, h('b', null, job.processed + '/' + job.requested), h('span', null, '已处理 / 上限')),
                h('div', { className: 'ag-metric' }, h('b', null, job.scored), h('span', null, '正常评分')),
                h('div', { className: 'ag-metric' }, h('b', null, job.review), h('span', null, '需复核')),
                h('div', { className: 'ag-metric' }, h('b', null, job.failed), h('span', null, '调用失败'))),
              (job.results || []).length ? h('div', { className: 'ag-list', style: { marginTop: 12 } },
                job.results.slice(-20).reverse().map((r, i) => h('div', { key: i, className: 'ag-item' },
                  h('b', { className: 'k' }, r.paper_id),
                  h('span', { className: 'ag-tag ' + (r.status === 'scored' ? 'g' : r.status === 'review' ? 'w' : 'e') }, { scored: '已评分', review: '需复核', failed: '失败' }[r.status] || r.status),
                  h('div', { className: 'ag-g' }, h('span', { className: 'k' }, r.score == null ? '—' : r.score + ' 分'), r.reason ? h('div', { className: 'v', style: { marginTop: 2, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.reason) : null),
                  Array.from({ length: r.image_count || 0 }, (_, pi) => h('img', { key: pi, className: 'ag-thumb', style: { marginLeft: 4 }, src: apiBase() + accountPath(accountId, 'job-image') + '?job=' + job.id + '&paper=' + r.paper_id + '&page=' + pi, alt: r.paper_id }))))) : null,
            )) : null,
          )))
      }

      /* ---------------- 设置页 ---------------- */
      const refreshLlmModels = async () => {
        setBusy('llm-models')
        try {
          const r = await postJson('llm-models', {})
          setLlmProviders(r.providers || [])
        } catch (e) { flash('读取模型列表失败：' + e.message, true) }
        finally { setBusy('') }
      }
      const selectedProviderModels = (() => {
        if (!llmProviders) return []
        const found = llmProviders.find((pv) => pv.provider === modelForm.provider)
        if (found) return found.models || []
        // 未选 provider 时汇总所有模型
        return llmProviders.flatMap((pv) => (pv.models || []).map((m) => ({ ...m, name: `${pv.name} · ${m.name}` })))
      })()

      const savePrompt = async () => {
        const r = await act('save-prompt', { prompt: promptText }, '总提示词已保存')
        if (r && mounted.current) { try { writeDraft(draftKey('promptText'), promptText) } catch { setDraftError('提示词已保存到后端，浏览器草稿空间不足。') } }
      }
      const resetDefaults = async () => {
        if (!window.confirm('确认恢复默认设置？将清除当前账号的模型配置与总提示词修改。')) return
        await act('reset-defaults', {}, '已恢复默认设置')
        // 同步本地表单
        const s = await getState(accountId)
        if (!mounted.current) return
        setState(s)
        setPromptText(s.prompt || '')
        setModelMode('harness')
        setModelForm({ provider: '', model: '', base_url: 'https://api.openai.com/v1', api_key: '', grading_effort: 'low' })
      }
      const saveModel = async () => {
        const body = modelMode === 'api'
          ? { mode: 'api', base_url: modelForm.base_url, model: modelForm.model, api_key: modelForm.api_key }
          : { mode: 'harness', provider: modelForm.provider, model: modelForm.model, grading_effort: modelForm.grading_effort || 'low' }
        await act('model', body, '模型配置已保存')
      }
      const loadConfig = async () => {
        if (!qid) { flash('请先在自动阅卷页选择题号', true); return }
        setBusy('config')
        try { await fetchConfig(state.exam, state.subject, qid, false) } catch (e) { flash(e.message, true) } finally { setBusy('') }
      }
      const saveConfig = async () => {
        if (!qid) { flash('请先在自动阅卷页选择题号', true); return }
        try { assertDraftSelection() } catch (e) { flash(e.message, true); return }
        let criteria
        try { criteria = JSON.parse(configForm.criteria) } catch { flash('评分项 JSON 格式错误', true); return }
        const sequence = configLoadSeq.current
        const r = await act('save-config', {
          exam: Number(state.exam), subject: Number(state.subject), question: qid,
          config: { question: configForm.question, question_prompt: configForm.question_prompt, teacher_standard: configForm.teacher_standard || '', criteria, grading_method: configForm.grading_method, question_type: configForm.question_type, max_score: config?.max_score, extra_line_penalty: Number(configForm.extra_line_penalty || 0), stem_image: stemImage, reference_image: refImage },
        }, '本题配置已保存')
        if (r && mounted.current && sequence === configLoadSeq.current) {
          setLoadedConfig(r)
          setDraftError('')
        }
      }
      const aiGenerate = async (mode = 'generate') => {
        if (!qid) { flash('请先在自动阅卷页选择题号', true); return }
        if (!model) { flash('请先配置模型', true); return }
        setBusy('config-generate')
        setGenerationFeedback(null)
        try {
          assertDraftSelection()
          let criteria = []
          try { criteria = JSON.parse(configForm.criteria || '[]') } catch { throw new Error('请先修正评分项JSON，再生成或优化') }
          const sequence = configLoadSeq.current
          const g = await postJson('config-generate', { exam: Number(state.exam), subject: Number(state.subject), question: qid, mode,
            question_type: configForm.question_type, max_score: config?.max_score, teacher_standard: configForm.teacher_standard || '',
            existing: { ...configForm, criteria }, stem_image: stemImage, reference_image: refImage })
          if (!mounted.current || sequence !== configLoadSeq.current) return
          setConfigForm({ ...configForm, question: g.question, question_prompt: g.question_prompt, criteria: JSON.stringify(g.criteria, null, 2), grading_method: g.grading_method, question_type: g.question_type })
          setGenerationFeedback({ warnings: g.warnings || [], changes: g.changes || [] })
          flash('AI 已生成评分配置，请核对后保存')
        } catch (e) { flash(e.message, true) } finally { setBusy('') }
      }
      const readFileAsDataUrl = (file, cb) => {
        if (!file) return
        if (file.size > 2 * 1024 * 1024) { flash('图片请控制在2MB以内', true); return }
        const r = new FileReader()
        const sequence = configLoadSeq.current
        r.onload = () => { if (mounted.current && sequence === configLoadSeq.current) cb(r.result) }
        r.readAsDataURL(file)
      }

      return h('div', { className: 'ag-page' }, h('style', { 'data-plugin': NS }, CSS),
        h('div', { className: 'ag-scroll', ref: scrollRef, onScroll: rememberScroll }, h('div', { className: 'ag-in' },
          header,
          connectionNotice,
          error ? h('div', { className: 'ag-err' }, error) : null,
          notice ? h('div', { className: 'ag-ok' }, notice) : null,

          h('div', { className: 'ag-settings-layout' },
            h('nav', { className: 'ag-settings-nav', 'aria-label': '设置分区' },
              [['rubric', '评分标准'], ['prompt', '总提示词'], ['model', '模型与接口'], ['trial', '评分试验'], ['general', '其他设置']].map(([id, label], i) =>
                h('button', { key: id, id: 'ag-settings-nav-' + id, type: 'button', className: settingsSection === id ? 'on' : '', 'aria-current': settingsSection === id ? 'page' : undefined, 'aria-controls': 'ag-settings-' + id, onClick: () => setSettingsSection(id) }, h('span', { 'aria-hidden': true }, String(i + 1).padStart(2, '0')), label))),
            h('div', { className: 'ag-settings-content' },
          h('section', { className: 'ag-settings-section', id: 'ag-settings-rubric', hidden: settingsSection !== 'rubric', 'aria-labelledby': 'ag-settings-nav-rubric' },
          h('div', { className: 'ag-sec' }, '本题配置',
            h('span', { className: 'ag-tag m' }, qid ? '题目 ' + qid + (config ? (Number.isFinite(Number(config.max_score)) && Number(config.max_score) > 0 ? ' · 满分 ' + config.max_score : ' · 满分待获取，请重新载入题目') : '') : '未选择题号')),
          h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
            h('div', { className: 'ag-row', style: { marginBottom: 12, alignItems: 'center' } },
              h('button', { className: 'ag-b sm', onClick: loadConfig, disabled: busy === 'config' }, '载入本题配置'),
              h('span', { className: 'ag-hint' }, '编辑当前选中题目的评分标准')),
            h('div', { className: 'ag-field', style: { marginBottom: 12 } }, h('label', null, '题干 / 评分范围'), h('textarea', { rows: 3, value: configForm.question, onChange: (e) => setConfigForm({ ...configForm, question: e.target.value }) })),
            h('div', { className: 'ag-field', style: { marginBottom: 12 } }, h('label', null, '题目特化提示词（标准答案、评分范围与特别要求）'), h('textarea', { rows: 6, value: configForm.question_prompt, onChange: (e) => setConfigForm({ ...configForm, question_prompt: e.target.value }) })),
            h('details', { className: 'ag-fold', style: { marginBottom: 12 } },
              h('summary', null, '教师评分标准（可选）'),
              h('div', { className: 'ag-field', style: { marginTop: 8 } }, h('label', null, '教师评分标准（可选；供AI生成与核对，不填则明确标注建议分值）'), h('textarea', { rows: 3, value: configForm.teacher_standard || '', placeholder: '粘贴教师明确的给分点、分值及特殊要求', onChange: (e) => setConfigForm({ ...configForm, teacher_standard: e.target.value }) }))),
            h('div', { className: 'ag-row', style: { marginBottom: 12 } },
              h('div', { className: 'ag-field', style: { flex: 1 } }, h('label', null, '题目类型'), h('select', {
                value: configForm.question_type,
                onChange: (e) => {
                  const t = e.target.value
                  const method = { design: 'rubric', line: 'line_count', isometric: 'holistic_band', other: 'rubric' }[t] || 'rubric'
                  setConfigForm({ ...configForm, question_type: t, grading_method: method })
                },
              },
                h('option', { value: 'design' }, '设计 / 草图题（分段评分）'),
                h('option', { value: 'line' }, '三视图补线题（按线评分）'),
                h('option', { value: 'isometric' }, '轴测图题（整体分档）'),
                h('option', { value: 'other' }, '其他（分项评分）'))),
              h('div', { className: 'ag-field' }, h('label', null, '多补每条扣分'), h('input', { type: 'number', min: 0, step: 'any', value: configForm.extra_line_penalty, onChange: (e) => setConfigForm({ ...configForm, extra_line_penalty: e.target.value }) })),
            ),
            h('div', { className: 'ag-row', style: { marginBottom: 12 } },
              h('div', { className: 'ag-field', style: { flex: 1 } }, h('label', null, '题干图（原题图，可选）'),
                h('div', { className: 'ag-paste' + (stemImage ? ' has' : ''), tabIndex: 0, role: 'button',
                  onClick: () => { pasteTargetRef.current = { cb: setStemImage }; document.getElementById('stem-file')?.click() },
                  onKeyDown: (e) => { if (e.key === 'Enter') { pasteTargetRef.current = { cb: setStemImage }; document.getElementById('stem-file')?.click() } },
                }, stemImage ? '已载入，点击重选或 Ctrl+V 粘贴' : '点击选择，或 Ctrl+V 粘贴图片'),
                h('input', { id: 'stem-file', type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (e) => readFileAsDataUrl(e.target.files[0], setStemImage) })),
              h('div', { className: 'ag-field', style: { flex: 1 } }, h('label', null, '参考答案图（可选）'),
                h('div', { className: 'ag-paste' + (refImage ? ' has' : ''), tabIndex: 0, role: 'button',
                  onClick: () => { pasteTargetRef.current = { cb: setRefImage }; document.getElementById('ref-file')?.click() },
                  onKeyDown: (e) => { if (e.key === 'Enter') { pasteTargetRef.current = { cb: setRefImage }; document.getElementById('ref-file')?.click() } },
                }, refImage ? '已载入，点击重选或 Ctrl+V 粘贴' : '点击选择，或 Ctrl+V 粘贴图片'),
                h('input', { id: 'ref-file', type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (e) => readFileAsDataUrl(e.target.files[0], setRefImage) })),
            ),
            (stemImage || refImage) ? h('div', { className: 'ag-row', style: { marginBottom: 12, alignItems: 'center' } },
              stemImage ? h('div', { className: 'ag-field', style: { flex: 1 } },
                h('img', { className: 'ag-img', style: { maxHeight: 180 }, src: stemImage, alt: '题干图' }),
                h('button', { className: 'ag-b sm ghost', style: { marginTop: 4 }, onClick: () => { setStemImage(null); if (pasteTargetRef.current && pasteTargetRef.current.cb === setStemImage) pasteTargetRef.current = null } }, '清除题干图')) : null,
              refImage ? h('div', { className: 'ag-field', style: { flex: 1 } },
                h('img', { className: 'ag-img', style: { maxHeight: 180 }, src: refImage, alt: '参考答案图' }),
                h('button', { className: 'ag-b sm ghost', style: { marginTop: 4 }, onClick: () => { setRefImage(null); if (pasteTargetRef.current && pasteTargetRef.current.cb === setRefImage) pasteTargetRef.current = null } }, '清除参考答案图')) : null,
            ) : null,
            h('div', { className: 'ag-field', style: { marginBottom: 14 } }, h('label', null, '评分项 JSON（id、description、max_score，合计须等于满分）'), h('textarea', { rows: 5, value: configForm.criteria, onChange: (e) => setConfigForm({ ...configForm, criteria: e.target.value }) })),
            h('div', { className: 'ag-row' },
              h('button', { className: 'ag-b pri', onClick: saveConfig, disabled: busy === 'save-config' }, busy === 'save-config' ? h('span', { className: 'ag-spin' }) : null, '保存本题配置'),
              h('button', { className: 'ag-b', onClick: () => aiGenerate('generate'), disabled: busy === 'config-generate' }, busy === 'config-generate' ? h('span', { className: 'ag-spin' }) : null, 'AI 首次生成'),
              h('button', { className: 'ag-b', onClick: () => aiGenerate('optimize'), disabled: busy === 'config-generate' || !configForm.criteria }, 'AI 优化现有配置'),
            ),
            h('details', { className: 'ag-detail' }, h('summary', null, 'AI 配置说明'),
              h('p', { className: 'ag-hint' }, '首次生成使用题干文字、图片与教师标准；优化现有配置保留评分项ID和分值。AI只更新编辑草稿，核对后保存。')),
            generationFeedback ? h('div', { style: { marginTop: 12, fontSize: 12 } },
              generationFeedback.warnings.length ? h('div', { className: 'ag-err' }, h('b', null, '待核对'), h('ul', null, generationFeedback.warnings.map((w, i) => h('li', { key: i }, w)))) : null,
              generationFeedback.changes.length ? h('div', null, h('b', null, '本次修改说明'), h('ul', null, generationFeedback.changes.map((c, i) => h('li', { key: i }, c)))) : null) : null,
          ))),

          h('section', { className: 'ag-settings-section', id: 'ag-settings-prompt', hidden: settingsSection !== 'prompt', 'aria-labelledby': 'ag-settings-nav-prompt' },
          h('div', { className: 'ag-sec' }, '总提示词'),
          h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
            h('details', { className: 'ag-fold' },
              h('summary', null, '跨题复用的判分方法', h('span', { className: 'ag-hint' }, `（${(promptText || '').length} 字）`)),
              h('div', { className: 'ag-field', style: { margin: '10px 0 14px' } }, h('label', null, '跨题复用的判分方法（可编辑）'), h('textarea', { rows: 13, value: promptText, onChange: (e) => setPromptText(e.target.value) }))),
            h('button', { className: 'ag-b pri', onClick: savePrompt, disabled: busy === 'save-prompt' }, busy === 'save-prompt' ? h('span', { className: 'ag-spin' }) : null, '保存总提示词'),
          ))),

          h('section', { className: 'ag-settings-section', id: 'ag-settings-model', hidden: settingsSection !== 'model', 'aria-labelledby': 'ag-settings-nav-model' },
          h('div', { className: 'ag-sec' }, '模型与 API 接口'),
          h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
            h('div', { className: 'ag-row', style: { marginBottom: 12 } },
              h('div', { className: 'ag-field' }, h('label', null, '来源'), h('select', { value: modelMode, onChange: (e) => setModelMode(e.target.value) },
                h('option', { value: 'harness' }, 'DSH 当前模型（无额外 Key）'),
                h('option', { value: 'api' }, '兼容 Chat Completions 的 API'))),
              h('span', { className: 'ag-tag ' + (model ? 'g' : 'm') }, model ? (model.mode === 'harness' ? 'DSH 模型' : 'API 模型') : '未配置'),
            ),
            modelMode === 'harness'
              ? h('div', null,
                  h('div', { className: 'ag-row', style: { marginBottom: 8 } },
                    h('div', { className: 'ag-field', style: { flex: '1 1 200px' } }, h('label', null, 'Provider'), h('select', {
                      value: modelForm.provider,
                      onChange: (e) => setModelForm({ ...modelForm, provider: e.target.value, model: '' }),
                    }, h('option', { value: '' }, '（默认：当前会话模型）'),
                       (llmProviders || []).map((pv) => h('option', { key: pv.provider, value: pv.provider }, pv.name)))),
                    h('div', { className: 'ag-field', style: { flex: '2 1 260px' } }, h('label', null, '模型'), h('select', {
                      value: modelForm.model,
                      onChange: (e) => setModelForm({ ...modelForm, model: e.target.value }),
                    }, h('option', { value: '' }, '（默认：当前会话模型）'),
                       (selectedProviderModels || []).map((m) => h('option', { key: m.id, value: m.id }, `${m.name}${m.image ? ' · 支持图片' : '（不支持图片）'}`)))),
                  ),
                  h('div', { style: { fontSize: 11, color: 'var(--tm)', marginBottom: 8 } },
                    llmProviders == null ? '正在读取 DSH 模型列表…'
                      : (llmProviders.length === 0 ? '未发现 DSH 模型；请在 DSH 设置里先配置模型。'
                        : '选「（默认：当前会话模型）」即跟随 DSH 当前会话所用的模型。')),
                  h('button', { className: 'ag-b sm', style: { marginBottom: 12 }, onClick: refreshLlmModels, disabled: busy === 'llm-models' }, '刷新模型列表'),
                  h('div', { className: 'ag-field', style: { marginBottom: 12 } }, h('label', null, '逐份阅卷推理强度'),
                    h('select', { value: modelForm.grading_effort || 'low', onChange: (e) => setModelForm({ ...modelForm, grading_effort: e.target.value }) },
                      h('option', { value: 'low' }, '快速：支持时使用 low'), h('option', { value: 'default' }, '使用模型默认强度')),
                    h('div', { style: { fontSize: 11, color: 'var(--tm)', marginTop: 4 } }, '仅影响逐份评分；生成评分标准保留模型默认强度。不支持 low 的模型使用默认设置。')),
                )
              : h('div', { className: 'ag-row', style: { marginBottom: 12 } },
                  h('div', { className: 'ag-field', style: { flex: '2 1 260px' } }, h('label', null, 'API Base URL'), h('input', { value: modelForm.base_url, onChange: (e) => setModelForm({ ...modelForm, base_url: e.target.value }) })),
                  h('div', { className: 'ag-field', style: { flex: '1 1 160px' } }, h('label', null, '模型名称'), h('input', { value: modelForm.model, onChange: (e) => setModelForm({ ...modelForm, model: e.target.value }) })),
                  h('div', { className: 'ag-field', style: { flex: '1 1 180px' } }, h('label', null, 'API Key'), h('input', { type: 'password', value: modelForm.api_key, onChange: (e) => setModelForm({ ...modelForm, api_key: e.target.value }) }))),
            h('button', { className: 'ag-b pri', onClick: saveModel, disabled: busy === 'model' }, busy === 'model' ? h('span', { className: 'ag-spin' }) : null, '保存模型配置'),
          ))),

          h('section', { className: 'ag-settings-section', id: 'ag-settings-trial', hidden: settingsSection !== 'trial', 'aria-labelledby': 'ag-settings-nav-trial' },
          settingsSection === 'trial' ? h(DecisionsTrial, { postJson, configForm, maxScore: config?.max_score, promptText, stemImage, refImage,
            selectionKey: qid ? `${state.exam}:${state.subject}:${qid}` : '' }) : null),

          h('section', { className: 'ag-settings-section', id: 'ag-settings-general', hidden: settingsSection !== 'general', 'aria-labelledby': 'ag-settings-nav-general' },
          h('div', { className: 'ag-sec' }, '其他'),
          h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
            h('div', { className: 'ag-row', style: { alignItems: 'center' } },
              h('button', { className: 'ag-b danger', onClick: resetDefaults, disabled: busy === 'reset-defaults' }, busy === 'reset-defaults' ? h('span', { className: 'ag-spin' }) : null, '一键恢复默认设置'),
              h('span', { style: { fontSize: 11, color: 'var(--tm)' } }, '模型配置与总提示词按账号保存，登录后自动载入；恢复默认会清除当前账号的修改。'),
            ),
          ))),
        )))))
    }

    class WorkbenchBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { console.error('[ameqp-grading 1.2.7] 页面渲染失败', error) }
      render() {
        if (!this.state.error) return this.props.children
        return h('div', { className: 'ag-page' }, h('style', { 'data-plugin': NS }, CSS),
          h('div', { className: 'ag-in' }, h('div', { className: 'ag-card' }, h('div', { className: 'ag-body' },
            h('h2', null, '阅卷工作台加载失败'),
            h('div', { className: 'ag-err', role: 'alert' }, this.state.error.message || String(this.state.error)),
            h('button', { className: 'ag-b', onClick: () => this.setState({ error: null }) }, '重新打开工作台'),
            h('div', { style: { marginTop: 10, fontSize: 12 } }, '重新打开只恢复页面，不会领卷、提交或取消当前答卷。')))))
      }
    }

function createArchiveView(React) {
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React
    const NS = 'exam-archive'
    const VERSION = '1.0.3'
    const dictionaries = {
      zh: {
        title: '阅卷归档', collection: '收件状态', records: '提醒记录', exam: '当前考试',
        choose: '选择考试', latest: '开启最新', refresh: '刷新', archive: '从群归档',
        start: '开始提醒', end: '结束提醒', previewStart: '预演开始提醒', previewEnd: '预演结束提醒',
        preview: '仅预演，不发送消息', sending: '提醒发送已开启', loading: '正在读取…', retry: '重试',
        roster: '组长表', notLoaded: '未载入', leaders: '{count} 位组长', synced: '扫描于 {time}',
        subject: '科目', leader: '备课组长', subjective: '主观标准', objective: '客观标准',
        status: '收件状态', time: '考试时间', details: '明细', expand: '展开', collapse: '收起',
        complete: '已收齐', missing: '缺文件', done: '{done}/{total} 科已收齐',
        missingCount: '{count} 科缺失', onlyMissing: '只看缺失', files: '{count} 份',
        noSubjects: '暂无科目数据，请检查考试目录。', allDone: '当前年级已全部收齐。',
        noExam: '选择考试后查看各科收件情况。', noExams: '未找到考试目录',
        noFiles: '尚未收到评分标准', directory: '归档目录', noRecords: '暂无提醒记录',
        recipient: '提醒对象', content: '提醒内容', at: '记录时间', phase: '阶段',
        startPhase: '开始', endPhase: '结束', noLeader: '未匹配组长', unscheduled: '未设置',
        error: '操作失败：{reason}', timeout: '请求超时，请检查共享盘连接。后台操作可能仍在进行，请勿重复提交。',
        activated: '已切换考试', archived: '归档完成：成功 {done} 个，跳过或失败 {failed} 个',
        previewed: '已生成 {count} 条预演记录，未发送', sent: '提醒操作完成，共 {count} 条',
      },
      en: {
        title: 'Exam archive', collection: 'Collection', records: 'Reminders', exam: 'Exam',
        choose: 'Select an exam', latest: 'Use latest', refresh: 'Refresh', archive: 'Archive from group',
        start: 'Start reminders', end: 'End reminders', previewStart: 'Preview start', previewEnd: 'Preview end',
        preview: 'Preview only · no messages sent', sending: 'Sending enabled', loading: 'Loading…', retry: 'Retry',
        roster: 'Roster', notLoaded: 'Not loaded', leaders: '{count} subject leads', synced: 'Scanned at {time}',
        subject: 'Subject', leader: 'Subject lead', subjective: 'Subjective', objective: 'Objective',
        status: 'Status', time: 'Exam time', details: 'Files', expand: 'Show', collapse: 'Hide',
        complete: 'Complete', missing: 'Missing', done: '{done}/{total} complete',
        missingCount: '{count} missing', onlyMissing: 'Missing only', files: '{count} files',
        noSubjects: 'No subjects found. Check the exam folder.', allDone: 'All subjects in this grade are complete.',
        noExam: 'Select an exam to view collection status.', noExams: 'No exam folders found',
        noFiles: 'No scoring standards received', directory: 'Folder', noRecords: 'No reminders yet',
        recipient: 'Recipient', content: 'Message', at: 'Recorded at', phase: 'Phase',
        startPhase: 'Start', endPhase: 'End', noLeader: 'No subject lead', unscheduled: 'Not set',
        error: 'Operation failed: {reason}', timeout: 'Request timed out. Check the shared folder. A background operation may still be running; avoid resubmitting.',
        activated: 'Exam selected', archived: 'Archived {done}; skipped or failed {failed}',
        previewed: 'Created {count} preview records; no messages sent', sent: 'Reminder operation completed: {count}',
      },
    }

    // Scoped controls follow the Host's neutral management-list hierarchy.
    // The panel stays bounded; only the table scrolls. File names are disclosure content.
    const CSS = `
.ea3{--line:var(--dsw-alias-border-l1);--line2:var(--dsw-alias-border-l2);--text:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--base:var(--dsw-alias-bg-base);--surface:var(--dsw-alias-bg-layer-1);--hover:var(--dsw-alias-bg-layer-2);--brand:var(--dsw-alias-brand-primary);box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--base);color:var(--text);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5;overflow:hidden}
.ea3 *{box-sizing:border-box}
.ea3 button,.ea3 select,.ea3 input{font:inherit}
.ea3-header{display:flex;align-items:center;gap:10px;flex:none;padding:12px 20px;border-bottom:1px solid var(--line)}
.ea3 h1{font-size:15px;line-height:22px;font-weight:600;margin:0}
.ea3-version{font-size:11px;color:var(--muted)}
.ea3-grow{flex:1;min-width:0}
.ea3-muted{color:var(--muted);font-size:12px}
.ea3-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:3px 10px;background:transparent;color:var(--text);border:1px solid var(--line2);border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:500}
.ea3-button:hover:enabled{background:var(--hover)}
.ea3-button:disabled{opacity:.45;cursor:default}
.ea3-button.primary{background:var(--brand);border-color:var(--brand);color:var(--base)}
.ea3-button.primary:hover:enabled{filter:brightness(.95)}
.ea3-button.link{border:0;color:var(--muted);padding:2px 6px;min-height:24px;font-size:12px}
.ea3 :is(button,select,input,summary):focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.ea3-toolbar{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;padding:12px 20px 10px}
.ea3-select{height:30px;max-width:440px;min-width:160px;flex:1;border:1px solid var(--line2);border-radius:6px;background:var(--base);color:var(--text);padding:3px 28px 3px 8px;overflow:hidden;text-overflow:ellipsis}
.ea3-tabs{display:flex;align-items:center;gap:18px;padding:0 20px;border-bottom:1px solid var(--line);flex:none}
.ea3-tab{padding:8px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-weight:500;white-space:nowrap}
.ea3-tab[aria-pressed=true]{color:var(--text);border-bottom-color:var(--text)}
.ea3-count{margin-left:6px;color:var(--muted);font-size:12px;font-weight:400;font-variant-numeric:tabular-nums}
.ea3-controls{display:flex;align-items:center;gap:6px;padding:8px 20px;flex:none;min-height:44px;flex-wrap:wrap}
.ea3-grade{padding:3px 9px;min-height:26px;background:transparent;border:1px solid transparent;border-radius:5px;color:var(--muted);cursor:pointer;white-space:nowrap}
.ea3-grade[aria-pressed=true]{background:var(--hover);color:var(--text);border-color:var(--line)}
.ea3-filter{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:12px;color:var(--muted);cursor:pointer}
.ea3-filter input{accent-color:var(--brand);margin:0;width:13px;height:13px}
.ea3-table-scroll{flex:1;min-height:0;overflow:auto;margin:0 20px;border:1px solid var(--line);border-radius:7px;overscroll-behavior:contain}
.ea3-table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%;min-width:650px;font-size:13px}
.ea3-table th{position:sticky;top:0;z-index:1;background:var(--surface);color:var(--muted);font-size:12px;font-weight:400;text-align:left;height:32px;padding:5px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.ea3-table td{height:34px;padding:5px 12px;border-bottom:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.ea3-table tbody tr:last-child td{border-bottom:0}
.ea3-table .ea3-subject-row:hover td{background:var(--hover)}
.ea3-table td:first-child{font-weight:500}
.ea3-status{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted)}
.ea3-status:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.ea3-status.complete{color:var(--dsw-alias-state-success-primary)}
.ea3-status.missing{color:var(--dsw-alias-state-warn-primary)}
.ea3-table td.ea3-detail{white-space:normal;padding:10px 14px;background:var(--surface);font-weight:400}
.ea3-unit+.ea3-unit{margin-top:10px}
.ea3-file{display:flex;gap:8px;align-items:baseline;padding:3px 0;overflow-wrap:anywhere;font-size:12px}
.ea3-file:before{content:"↳";color:var(--muted);flex:none}
.ea3-path{color:var(--muted);font-size:12px;margin-bottom:4px}
.ea3-footer{display:flex;align-items:center;gap:12px;flex:none;min-height:34px;padding:7px 20px;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden}
.ea3-footer .ea3-source{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.ea3-message{margin:0 20px 8px;padding:6px 10px;flex:none;border-radius:5px;background:var(--hover);font-size:12px}
.ea3-message.error{color:var(--dsw-alias-state-error-primary)}
.ea3-empty{padding:26px 16px;text-align:center;color:var(--muted);font-size:13px}
.ea3-record-text{white-space:normal!important;overflow-wrap:anywhere}
@media(max-width:720px){.ea3-header,.ea3-toolbar,.ea3-controls,.ea3-footer{padding-left:12px;padding-right:12px}.ea3-tabs{padding-left:12px;padding-right:12px}.ea3-table-scroll{margin:0 12px}.ea3-toolbar .ea3-select{max-width:none}.ea3-toolbar .ea3-grow{display:none}.ea3-controls{gap:3px}.ea3-tabs{gap:14px}}
`

    const apiBase = () => new URL('exam-archive/api/', document.baseURI).href
    async function request(op, options, timeoutText) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), op === 'archive' ? 600000 : 30000)
      try {
        const response = await fetch(apiBase() + op, { ...options, cache: 'no-store', signal: controller.signal })
        const result = await response.json()
        if (!response.ok || !result?.ok) throw new Error(result?.error || 'HTTP ' + response.status)
        return result
      } catch (error) {
        if (error.name === 'AbortError') throw new Error(timeoutText)
        throw error
      } finally { clearTimeout(timer) }
    }

    function PanelIcon({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M6 4h9l3 3v13H6V4zM15 4v3h3M9 11h6M9 14h6M9 17h3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }))
    }

    function SubjectRows({ subject: s, expanded, onToggle, t }) {
      const units = s.units || []
      const subjective = units.reduce((n, u) => n + u.subjective, 0)
      const objective = units.reduce((n, u) => n + u.objective, 0)
      return h(React.Fragment, null,
        h('tr', { className: 'ea3-subject-row' },
          h('td', null, s.subject),
          h('td', { title: s.leader || t('noLeader') }, s.leader || '—'),
          h('td', null, t('files', { count: subjective })),
          h('td', null, t('files', { count: objective })),
          h('td', null, h('span', { className: 'ea3-status ' + (s.complete ? 'complete' : 'missing') }, t(s.complete ? 'complete' : 'missing'))),
          h('td', { className: 'ea3-muted', title: s.start || s.end ? `${s.start || '—'} – ${s.end || '—'}` : t('unscheduled') }, s.start || s.end ? `${s.start || '—'} – ${s.end || '—'}` : '—'),
          h('td', null, h('button', { type: 'button', className: 'ea3-button link', 'aria-expanded': expanded, 'aria-label': s.subject + ' · ' + t('details'), onClick: onToggle }, t(expanded ? 'collapse' : 'expand')))),
        expanded ? h('tr', null, h('td', { colSpan: 7, className: 'ea3-detail' },
          units.map((unit, i) => h('div', { className: 'ea3-unit', key: i },
            h('div', { className: 'ea3-path' }, t('directory') + ' · ' + unit.dir),
            unit.files?.length ? unit.files.map(file => h('div', { className: 'ea3-file', key: file }, file)) : h('span', { className: 'ea3-muted' }, t('noFiles')))))) : null)
    }

    function App({ locale, t }) {
      useSyncExternalStore(useCallback(fn => locale.subscribe(fn), [locale]), useCallback(() => locale.getSnapshot(), [locale]))
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [grade, setGrade] = useState('')
      const [view, setView] = useState('collection')
      const [onlyMissing, setOnlyMissing] = useState(false)
      const [expanded, setExpanded] = useState('')
      const pending = useRef(false)
      const mounted = useRef(true)
      useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
      const load = useCallback(async () => {
        const result = await request('state', {}, t('timeout'))
        if (mounted.current) setState(result)
      }, [t])
      useEffect(() => { load().catch(e => { if (mounted.current) setError(e.message) }) }, [load])
      const act = async (op, body = {}) => {
        if (pending.current) return
        pending.current = true
        setBusy(op); setError(''); setNotice('')
        try {
          if (op === 'refresh') await load()
          else {
            const result = await request(op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, t('timeout'))
            await load()
            if (!mounted.current) return
            if (op === 'activate') { setExpanded(''); setNotice(t('activated')) }
            if (op === 'archive') setNotice(t('archived', result))
            if (op === 'remind') setNotice(t(result.sent ? 'sent' : 'previewed', result))
          }
        } catch (e) { if (mounted.current) setError(t('error', { reason: e.message })) }
        finally { pending.current = false; if (mounted.current) setBusy('') }
      }
      const subjects = state?.activeStatus?.subjects || []
      const present = [...new Set(subjects.map(s => s.grade))].sort()
      const activeGrade = present.includes(grade) ? grade : present[0]
      const gradeSubjects = subjects.filter(s => s.grade === activeGrade)
      const visible = gradeSubjects.filter(s => !onlyMissing || !s.complete)
      const status = state?.activeStatus
      const records = state?.reminders || []
      const exams = state?.exams || []
      const sending = !!state?.settings?.sendReminders
      const button = (label, onClick, primary = false, disabled = false) => h('button', {
        type: 'button', className: 'ea3-button' + (primary ? ' primary' : ''), disabled: !!busy || disabled, onClick,
      }, label)
      const empty = text => h('div', { className: 'ea3-empty' }, text)
      const totalDone = status ? t('done', status) : ''
      const roster = state?.roster
      return h('section', { className: 'ea3', 'aria-label': t('title'), 'aria-busy': !!busy, 'data-version': VERSION },
        h('style', { 'data-plugin': NS }, CSS),
        h('header', { className: 'ea3-header' },
          h(PanelIcon, { size: 18 }), h('h1', null, t('title')), h('span', { className: 'ea3-version' }, 'v' + VERSION),
          h('div', { className: 'ea3-grow' }),
          h('span', { className: 'ea3-muted' }, t(sending ? 'sending' : 'preview'))),
        h('div', { className: 'ea3-toolbar' },
          h('label', { className: 'ea3-muted', htmlFor: 'ea3-exam' }, t('exam')),
          h('select', { id: 'ea3-exam', className: 'ea3-select', value: state?.activeExam || '', disabled: !!busy || !state || !exams.length,
            onChange: e => { if (e.target.value) act('activate', { examName: e.target.value }) } },
            h('option', { value: '', disabled: true }, t(exams.length ? 'choose' : 'noExams')),
            exams.map(name => h('option', { value: name, key: name }, name))),
          button(t('latest'), () => act('activate', { examName: exams[0] }), false, !exams.length),
          h('div', { className: 'ea3-grow' }),
          button(busy === 'refresh' ? t('loading') : t('refresh'), () => act('refresh')),
          button(busy === 'archive' ? t('loading') : t('archive'), () => act('archive', { examName: state.activeExam, hoursBack: 72 }), true, !status)),
        error ? h('div', { className: 'ea3-message error', role: 'alert' }, error) : null,
        notice ? h('div', { className: 'ea3-message', role: 'status' }, notice) : null,
        h('nav', { className: 'ea3-tabs', 'aria-label': t('title') },
          h('button', { type: 'button', className: 'ea3-tab', 'aria-pressed': view === 'collection', onClick: () => setView('collection') }, t('collection'), h('span', { className: 'ea3-count' }, totalDone)),
          h('button', { type: 'button', className: 'ea3-tab', 'aria-pressed': view === 'records', onClick: () => setView('records') }, t('records'), h('span', { className: 'ea3-count' }, records.length))),
        view === 'collection' ? h('div', { className: 'ea3-controls' },
          present.map(g => {
            const rows = subjects.filter(s => s.grade === g)
            return h('button', { type: 'button', className: 'ea3-grade', key: g, 'aria-pressed': activeGrade === g,
              onClick: () => { setGrade(g); setExpanded('') } }, g, h('span', { className: 'ea3-count' }, rows.filter(s => s.complete).length + '/' + rows.length))
          }),
          h('div', { className: 'ea3-grow' }),
          h('label', { className: 'ea3-filter' }, h('input', { type: 'checkbox', checked: onlyMissing, onChange: e => setOnlyMissing(e.target.checked) }), t('onlyMissing')),
          button(t(sending ? 'start' : 'previewStart'), () => act('remind', { phase: 'start' }), false, !status),
          button(t(sending ? 'end' : 'previewEnd'), () => act('remind', { phase: 'end' }), false, !status)) : null,
        h('div', { className: 'ea3-table-scroll' },
          !state ? empty(error ? t('retry') : t('loading')) : view === 'records' ? (
            records.length ? h('table', { className: 'ea3-table', 'aria-label': t('records') },
              h('colgroup', null, [10, 18, 50, 22].map((width, i) => h('col', { key: i, style: { width: width + '%' } }))),
              h('thead', null, h('tr', null, ['phase', 'recipient', 'content', 'at'].map(key => h('th', { key, scope: 'col' }, t(key))))),
              h('tbody', null, records.map(r => h('tr', { key: r.id },
                h('td', null, t(r.phase === 'end' ? 'endPhase' : 'startPhase')),
                h('td', { title: r.to || '' }, `${r.grade}${r.subject} · ${r.to || t('noLeader')}`),
                h('td', { className: 'ea3-record-text' }, r.text), h('td', { className: 'ea3-muted' }, r.at))))) : empty(t('noRecords'))
          ) : !status ? empty(t('noExam')) : h('table', { className: 'ea3-table', 'aria-label': t('collection') },
            h('colgroup', null, [10, 19, 13, 13, 15, 20, 10].map((width, i) => h('col', { key: i, style: { width: width + '%' } }))),
            h('thead', null, h('tr', null, ['subject', 'leader', 'subjective', 'objective', 'status', 'time', 'details'].map(key => h('th', { key, scope: 'col' }, t(key))))),
            h('tbody', null, visible.length ? visible.map(s => {
              const key = `${s.grade}|${s.subject}`
              return h(SubjectRows, { key, subject: s, t, expanded: expanded === key, onToggle: () => setExpanded(expanded === key ? '' : key) })
            }) : h('tr', null, h('td', { colSpan: 7 }, empty(t(onlyMissing ? 'allDone' : 'noSubjects'))))))),
        h('footer', { className: 'ea3-footer' },
          h('span', { className: 'ea3-source', title: roster?.file || roster?.error || '' },
            `${t('roster')} · ${roster?.file || roster?.error || t('notLoaded')}`),
          state ? h('span', null, t('leaders', { count: roster?.count || 0 })) : null,
          state ? h('span', null, t('synced', { time: (state.now || '').split(' ').pop() })) : null))
    }

    return { App, dictionaries, namespace: NS + "-ui" }
}

/** Combined UI; the build embeds this function in the one browser module. */
function createUnifiedPlugin({ React, App: GradingApp, WorkbenchBoundary, Icon, createArchiveView }) {
  const h = React.createElement
  const { useState, useRef, useSyncExternalStore, useCallback } = React
  const NS = 'exam-workbench'
  const LOCALE_NS = NS + '-ui'
  // The embedded archive view ships its own dictionaries. Register them under a
  // workbench-owned namespace: the legacy exam-archive plugin owns
  // `exam-archive-ui`, and DSH's locale registry throws when the same
  // namespace+language is registered twice. That throw aborts Client activation
  // and makes DSH fail the whole web boot.
  const ARCHIVE_LOCALE_NS = 'exam-workbench-archive-ui'
  const archive = createArchiveView(React)
  const dicts = {
    zh: { title: '阅卷工作台', grading: 'AI 阅卷', archive: '阅卷归档', navigation: '阅卷功能' },
    en: { title: 'Grading workbench', grading: 'AI grading', archive: 'Exam archive', navigation: 'Grading tools' },
  }
  const CSS = `
.ew-shell{height:100%;min-height:0;width:100%;min-width:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.ew-nav{display:flex;align-items:center;gap:20px;flex:none;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);min-height:46px;flex-wrap:wrap}
.ew-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;margin:0;white-space:nowrap}
.ew-tabs{display:flex;gap:16px;align-self:stretch}
.ew-tab{font:inherit;font-size:13px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);padding:12px 0;cursor:pointer;white-space:nowrap}
.ew-tab[aria-selected=true]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.ew-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.ew-panel{flex:1;min-height:0;min-width:0;overflow:hidden;display:flex;flex-direction:column}
.ew-panel[hidden]{display:none}
@media(max-width:520px){.ew-nav{padding:0 12px;gap:14px}.ew-title{font-size:13px}.ew-tabs{gap:12px}}
`
  function UnifiedApp({ locale, t, archiveT }) {
    useSyncExternalStore(useCallback(fn => locale.subscribe(fn), [locale]), useCallback(() => locale.getSnapshot(), [locale]))
    const [tab, setTab] = useState(() => {
      try { return sessionStorage.getItem('exam-workbench-tab') === 'archive' ? 'archive' : 'grading' } catch { return 'grading' }
    })
    const [archiveOpened, setArchiveOpened] = useState(tab === 'archive')
    const [gradingOpened, setGradingOpened] = useState(tab === 'grading')
    const refs = useRef({})
    function choose(next) {
      setTab(next)
      if (next === 'archive') setArchiveOpened(true)
      else setGradingOpened(true)
      try { sessionStorage.setItem('exam-workbench-tab', next) } catch { /* Storage can be unavailable. */ }
    }
    function onKey(event, current) {
      let next
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) next = current === 'grading' ? 'archive' : 'grading'
      else if (event.key === 'Home') next = 'grading'
      else if (event.key === 'End') next = 'archive'
      if (!next) return
      event.preventDefault(); choose(next); refs.current[next]?.focus()
    }
    return h('section', { className: 'ew-shell', 'aria-label': t('title') },
      h('style', { 'data-plugin': NS }, CSS),
      h('header', { className: 'ew-nav' },
        h('h1', { className: 'ew-title' }, h(Icon, { size: 19 }), t('title')),
        h('nav', { className: 'ew-tabs', role: 'tablist', 'aria-label': t('navigation') },
          ['grading', 'archive'].map(key => h('button', {
            key, ref: node => { refs.current[key] = node }, type: 'button', className: 'ew-tab', role: 'tab',
            id: 'ew-tab-' + key, 'aria-controls': 'ew-panel-' + key, 'aria-selected': tab === key,
            tabIndex: tab === key ? 0 : -1, onClick: () => choose(key), onKeyDown: event => onKey(event, key),
          }, t(key))))),
      h('div', { id: 'ew-panel-grading', className: 'ew-panel', role: 'tabpanel', 'aria-labelledby': 'ew-tab-grading', hidden: tab !== 'grading' },
        gradingOpened ? h(WorkbenchBoundary, null, h(GradingApp)) : null),
      h('div', { id: 'ew-panel-archive', className: 'ew-panel', role: 'tabpanel', 'aria-labelledby': 'ew-tab-archive', hidden: tab !== 'archive' },
        archiveOpened ? h(WorkbenchBoundary, null, h(archive.App, { locale, t: archiveT })) : null))
  }
  return {
    name: NS, isPlugin: true, inject: ['slots', 'locale'],
    apply(ctx) {
      // A namespace that is already taken (for example by a still-enabled
      // legacy archive plugin) must never reject this Client plugin: a rejected
      // plugin blocks DSH's web boot.
      const registerLocale = (namespace, language, values) => {
        ctx.effect(() => {
          try { return ctx.locale.register(namespace, language, values) }
          catch (error) {
            console.warn('[exam-workbench] locale namespace not registered:', namespace, language, error?.message || error)
            return () => {}
          }
        })
      }
      for (const language of ['zh', 'en']) {
        registerLocale(LOCALE_NS, language, dicts[language])
        registerLocale(ARCHIVE_LOCALE_NS, language, archive.dictionaries[language])
      }
      const t = ctx.locale.bind(LOCALE_NS)
      const archiveT = ctx.locale.bind(ARCHIVE_LOCALE_NS)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: NS }, () => h(UnifiedApp, { locale: ctx.locale, t, archiveT })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 32, label: () => t('title') }, props => h(Icon, props)))
    },
  }
}

    return createUnifiedPlugin({ React, App, WorkbenchBoundary, Icon, createArchiveView })

  },
})
