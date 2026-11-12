/* Browser entry: classic script; DSH owns React, the panel and its lifecycle. */
window.__ModuleLoader__.load({
  id: '@local/dsh-exam-archive',
  factory(require) {
    const React = require('react')
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

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS + '-ui', 'zh', dictionaries.zh))
        ctx.effect(() => ctx.locale.register(NS + '-ui', 'en', dictionaries.en))
        const t = ctx.locale.bind(NS + '-ui')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: NS, order: 32, label: () => t('title') }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: NS }, () => h(App, { locale: ctx.locale, t })))
      },
    }
  },
})
