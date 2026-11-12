/* 浏览器入口：普通脚本，React 与面板生命周期由 DSH 提供。 */
window.__ModuleLoader__.load({
  id: '@local/dsh-score-analysis',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React

    const NS = 'score-analysis'
    const VERSION = '1.0.0'
    const API_BASE = () => new URL('score-analysis/api/', document.baseURI).href

    /* ------------------------------------------------------------ 文案 */

    const dictionaries = {
      zh: {
        title: '成绩分析',
        subtitle: '上传原始小题分成绩，生成班级均分、信息/通用小题分析与成绩单。',
        uploadTitle: '小题分原始成绩文件',
        uploadHint: '.xls / .xlsx / .zip',
        dropHere: '点击或拖拽文件到这里',
        dropActive: '松开即可上传',
        noFile: '未选择文件',
        chooseFile: '选择文件',
        analyze: '开始处理',
        analyzing: '正在分析…',
        clear: '清空',
        mapping: '教学班映射',
        mappingUnset: '未导入',
        mappingImport: '导入映射表',
        mappingHint: '导入后会把成绩按信息班 / 通用班汇总，并生成成绩单。未导入时只出行政班分析。',
        result: '处理结果',
        empty: '上传成绩文件后在这里查看分析结果。',
        tabClass: '班级均分',
        tabInfo: '信息小题',
        tabGeneral: '通用小题',
        groupAdmin: '行政班级',
        groupTeaching: '教学班级',
        sumQuestions: '小题数',
        sumInfo: '信息题',
        sumGeneral: '通用题',
        sumUnknown: '未分类',
        adviceLow: '优先讲评小题',
        adviceWeak: '关注班级',
        adviceError: '错误率较高选择题',
        adviceEmpty: '暂无',
        noChoiceData: '暂无选择题答案数据',
        downloadWorkbook: '下载数据',
        downloadCards: '导出成绩单',
        sketchLabel: '草图低于',
        sketchSuffix: '分标红',
        projects: '已保存考试',
        projectEmpty: '还没有保存的考试。',
        projectSave: '保存此次考试',
        projectSaving: '保存中…',
        projectName: '考试项目名称',
        rename: '保存名称',
        remove: '删除',
        cancel: '取消',
        confirm: '确定',
        saveNamePrompt: '给这次考试起个名字，之后可以随时在左侧打开。',
        deletePrompt: '删除后该项目会从列表中移除，已生成的分析文件不受影响。',
        deleteTitle: '删除考试项目',
        refresh: '刷新',
        questions: '{count} 个小题',
        answered: '已答 {answered} / {total}',
        average: '均分 {value}',
        errorRate: '错误率 {value}',
        timeout: '请求超时，后台可能仍在处理，请稍候再刷新。',
        savedAt: '保存于 {time}',
        sourceFile: '来源文件',
        reportCardsCount: '{count} 份成绩单',
        loading: '加载中…',
        questionScope: '小题',
        noTableData: '暂无表格数据',
        unsupported: '请选择 .xls、.xlsx 或 .zip 文件',
        hintClassSheet: '这个文件名像分班表或汇总表，请确认选择的是原始小题分成绩文件。',
        hintZip: '已选择压缩包，处理时会自动提取“全体报表/小题分(...)”。',
        renamed: '项目名称已更新',
        savedProject: '考试项目已保存',
        deletedProject: '考试项目已删除',
        cardsUnavailable: '未生成成绩单：{reason}',
        errorPrefix: '操作失败：',
        analysisDone: '分析完成：{questions} 个小题，{classes} 个班级。',
      },
      en: {
        title: 'Score analysis',
        subtitle: 'Upload raw per-question scores to get class averages, item analysis and report cards.',
        uploadTitle: 'Raw per-question score sheet',
        uploadHint: '.xls / .xlsx / .zip',
        dropHere: 'Click or drop a file here',
        dropActive: 'Drop to upload',
        noFile: 'No file selected',
        chooseFile: 'Choose file',
        analyze: 'Analyze',
        analyzing: 'Analyzing…',
        clear: 'Clear',
        mapping: 'Teaching-class map',
        mappingUnset: 'Not imported',
        mappingImport: 'Import map',
        mappingHint: 'Import a class map to group scores by teaching class and generate report cards. Without it only administrative classes are produced.',
        result: 'Result',
        empty: 'Upload a score sheet to see the analysis here.',
        tabClass: 'Class averages',
        tabInfo: 'Info items',
        tabGeneral: 'General items',
        groupAdmin: 'Administrative',
        groupTeaching: 'Teaching',
        sumQuestions: 'Items',
        sumInfo: 'Info',
        sumGeneral: 'General',
        sumUnknown: 'Unclassified',
        adviceLow: 'Review first',
        adviceWeak: 'Weak classes',
        adviceError: 'High-error choices',
        adviceEmpty: 'None',
        noChoiceData: 'No choice answers available',
        downloadWorkbook: 'Download data',
        downloadCards: 'Report cards',
        sketchLabel: 'Highlight sketch below',
        sketchSuffix: '',
        projects: 'Saved exams',
        projectEmpty: 'No saved exams yet.',
        projectSave: 'Save this exam',
        projectSaving: 'Saving…',
        projectName: 'Exam name',
        rename: 'Save name',
        remove: 'Delete',
        cancel: 'Cancel',
        confirm: 'Confirm',
        saveNamePrompt: 'Name this exam; you can reopen it from the left at any time.',
        deletePrompt: 'The project leaves the list; already generated files are kept.',
        deleteTitle: 'Delete exam project',
        refresh: 'Refresh',
        questions: '{count} items',
        answered: 'Answered {answered} / {total}',
        average: 'Avg {value}',
        errorRate: 'Error {value}',
        timeout: 'Request timed out. A background task may still be running; refresh later.',
        savedAt: 'Saved {time}',
        sourceFile: 'Source',
        reportCardsCount: '{count} report cards',
        loading: 'Loading…',
        questionScope: 'Item',
        noTableData: 'No table data',
        unsupported: 'Choose a .xls, .xlsx or .zip file',
        hintClassSheet: 'This looks like a class roster or summary sheet; choose the raw per-question score file.',
        hintZip: 'Archive selected; the “全体报表/小题分(...)” sheet is extracted automatically.',
        renamed: 'Exam name updated',
        savedProject: 'Exam project saved',
        deletedProject: 'Exam project deleted',
        cardsUnavailable: 'No report cards: {reason}',
        errorPrefix: 'Failed: ',
        analysisDone: 'Analyzed {questions} items across {classes} classes.',
      },
    }

    /* ------------------------------------------------------------- 样式 */

    const CSS = `
.sax{--line:var(--dsw-alias-border-l1);--line2:var(--dsw-alias-border-l2);--text:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--base:var(--dsw-alias-bg-base);--surface:var(--dsw-alias-bg-layer-1);--hover:var(--dsw-alias-bg-layer-2);--brand:var(--dsw-alias-brand-primary);--ok:var(--dsw-alias-state-success-primary);--err:var(--dsw-alias-state-error-primary);box-sizing:border-box;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--base);color:var(--text);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5;overflow:hidden}
.sax *{box-sizing:border-box}
.sax button,.sax select,.sax input{font:inherit;color:inherit}
.sax-header{display:flex;align-items:center;gap:10px;flex:none;padding:12px 20px;border-bottom:1px solid var(--line)}
.sax-header h1{font-size:15px;line-height:22px;font-weight:600;margin:0;white-space:nowrap}
.sax-version{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.sax-sub{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sax-grow{flex:1;min-width:0}
.sax-muted{color:var(--muted);font-size:12px}
.sax-body{flex:1;min-height:0;display:flex;gap:16px;padding:16px 20px 14px;overflow:hidden}
.sax-side{width:306px;flex:none;display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;padding-right:2px}
.sax-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}
.sax-card{border:1px solid var(--line);border-radius:8px;background:var(--surface);display:flex;flex-direction:column;min-height:0}
.sax-card-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line);flex:none}
.sax-card-title{margin:0;font-size:13px;font-weight:600}
.sax-card-body{padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0}
.sax-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:3px 10px;background:transparent;color:var(--text);border:1px solid var(--line2);border-radius:6px;cursor:pointer;white-space:nowrap;font-weight:500}
.sax-button:hover:enabled{background:var(--hover)}
.sax-button:disabled{opacity:.45;cursor:default}
.sax-button.primary{background:var(--brand);border-color:var(--brand);color:var(--base)}
.sax-button.primary:hover:enabled{filter:brightness(.95)}
.sax-button.ghost{border-color:transparent;color:var(--muted);padding:2px 6px;min-height:24px;font-size:12px}
.sax-button.ghost:hover:enabled{background:var(--hover);color:var(--text)}
.sax :is(button,input,summary):focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.sax-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 12px;border:1px dashed var(--line2);border-radius:7px;background:transparent;cursor:pointer;text-align:center;color:var(--muted);transition:background .15s,border-color .15s}
.sax-drop:hover,.sax-drop[data-active=true]{background:var(--hover);border-color:var(--brand);color:var(--text)}
.sax-drop strong{font-size:13px;font-weight:500;color:var(--text)}
.sax-drop-name{font-size:12px;word-break:break-all;max-height:32px;overflow:hidden}
.sax-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sax-status{display:flex;align-items:flex-start;gap:6px;padding:7px 9px;border-radius:6px;background:var(--hover);font-size:12px;color:var(--muted);word-break:break-word}
.sax-status.err{color:var(--err)}
.sax-status.ok{color:var(--ok)}
.sax-tabs{display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--line);flex:none;padding:0 2px}
.sax-tab{padding:7px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-weight:500;white-space:nowrap}
.sax-tab[aria-pressed=true]{color:var(--text);border-bottom-color:var(--text)}
.sax-count{margin-left:6px;color:var(--muted);font-size:11px;font-weight:400;font-variant-numeric:tabular-nums}
.sax-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.sax-segment{display:inline-flex;border:1px solid var(--line2);border-radius:6px;overflow:hidden}
.sax-segment button{border:0;background:transparent;padding:3px 10px;min-height:26px;cursor:pointer;color:var(--muted);white-space:nowrap}
.sax-segment button[aria-pressed=true]{background:var(--hover);color:var(--text);font-weight:500}
.sax-segment button:disabled{opacity:.45;cursor:default}
.sax-threshold{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap}
.sax-threshold input{width:66px;height:26px;padding:2px 6px;border:1px solid var(--line2);border-radius:5px;background:var(--base);color:var(--text)}
.sax-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.sax-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}
.sax-table th{position:sticky;top:0;z-index:2;background:var(--surface);color:var(--muted);font-weight:400;text-align:right;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;font-size:12px}
.sax-table th:first-child{left:0;z-index:3;text-align:left}
.sax-table th.choice{cursor:help;text-decoration:underline dotted;text-underline-offset:3px}
.sax-table td{padding:5px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.sax-table td:first-child{position:sticky;left:0;z-index:1;background:var(--surface);text-align:left;font-weight:500}
.sax-table tbody tr:hover td{background:var(--hover)}
.sax-table tbody tr:hover td:first-child{background:var(--hover)}
.sax-table tbody tr:last-child td{border-bottom:0}
.sax-table tr.total td{font-weight:600;color:var(--text)}
.sax-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;flex:none}
.sax-kpi{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.sax-kpi-value{font-size:19px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}
.sax-kpi-label{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sax-advice{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;flex:none}
.sax-advice-box{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px 12px;min-height:96px;display:flex;flex-direction:column;gap:6px;min-width:0}
.sax-advice-head{margin:0;font-size:12px;font-weight:600;color:var(--muted)}
.sax-advice-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px}
.sax-advice-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sax-advice-row strong{font-variant-numeric:tabular-nums;font-weight:600}
.sax-chip{display:inline-flex;align-items:center;justify-content:center;min-width:34px;padding:2px 7px;border-radius:5px;border:1px solid var(--line2);background:transparent;font-size:12px;cursor:help;font-variant-numeric:tabular-nums}
.sax-chip:hover{background:var(--hover)}
.sax-chips{display:flex;flex-wrap:wrap;gap:5px}
.sax-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;min-height:180px;padding:20px;text-align:center}
.sax-projects{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto}
.sax-project{display:flex;align-items:center;gap:6px;border-radius:6px}
.sax-project button.sax-open{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;align-items:flex-start;background:transparent;border:0;border-radius:6px;padding:6px 8px;cursor:pointer;text-align:left}
.sax-project button.sax-open:hover{background:var(--hover)}
.sax-project[data-active=true] button.sax-open{background:var(--hover)}
.sax-project-name{font-size:12.5px;font-weight:500;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sax-project-date{font-size:11px;color:var(--muted)}
.sax-project .sax-remove{opacity:0;transition:opacity .12s}
.sax-project:hover .sax-remove{opacity:1}
.sax-footer{display:flex;align-items:center;gap:12px;flex:none;padding:0 20px 10px;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden}
.sax-footer span{overflow:hidden;text-overflow:ellipsis}
.sax-tooltip{position:fixed;z-index:2147483000;width:264px;padding:10px 12px;border:1px solid var(--line2);border-radius:8px;background:var(--dsw-alias-bg-overlay);color:var(--text);box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:12px;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.sax-tip-title{margin:0;font-size:13px;font-weight:600}
.sax-tip-sub{margin:0;color:var(--muted);font-size:11px;line-height:1.45}
.sax-tip-body{display:flex;align-items:center;gap:12px}
.sax-pie{width:72px;height:72px;border-radius:50%;flex:none}
.sax-legend{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.sax-legend-row{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.sax-dot{width:7px;height:7px;border-radius:50%;flex:none}
.sax-legend-name{width:26px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sax-legend-value{color:var(--muted);margin-left:auto}
.sax-warnings{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--muted);max-height:108px;overflow:auto}
.sax-warnings div{display:flex;gap:6px}
.sax-warnings div:before{content:"·";color:var(--muted)}
.sax-dialog-backdrop{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);padding:24px}
.sax-dialog{width:min(420px,100%);border:1px solid var(--line2);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--text);box-shadow:0 18px 48px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:12px;padding:16px 18px}
.sax-dialog h2{margin:0;font-size:14px;font-weight:600}
.sax-dialog p{margin:0;font-size:12px;color:var(--muted);line-height:1.5}
.sax-dialog input{height:32px;padding:4px 9px;border:1px solid var(--line2);border-radius:6px;background:var(--base);color:var(--text)}
.sax-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
@media(max-width:1080px){.sax-advice{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:920px){.sax-body{flex-direction:column;overflow:auto;padding:12px}.sax-side{width:auto;overflow:visible}.sax-main{min-height:420px}.sax-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.sax-advice{grid-template-columns:minmax(0,1fr)}.sax-sub{display:none}}
`

    /* -------------------------------------------------------------- 图标 */

    const Icon = ({ size = 18, path, stroke = 1.5 }) =>
      h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { flex: 'none' },
        },
        h('path', {
          d: path,
          stroke: 'currentColor',
          strokeWidth: stroke,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )

    const ICONS = {
      panel: 'M4 19V5m0 14h16M8 16V9m4 7V6m4 10v-4',
      upload: 'M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2',
      download: 'M12 4v12m0 0 4-4m-4 4-4-4M4 20h16',
      file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
      close: 'M6 6l12 12M18 6L6 18',
    }

    const PanelIcon = ({ size = 18 }) => h(Icon, { size, path: ICONS.panel })

    /* ---------------------------------------------------------- 工具函数 */

    const formatScore = (value) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return '-'
      return String(Number(number.toFixed(2)))
    }

    const formatPercent = (value) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return '-'
      return `${Number((number * 100).toFixed(1))}%`
    }

    const formatDate = (value) => {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return String(value || '')
      return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    }

    const CHOICE_COLORS = {
      A: '#ef4444',
      B: '#f59e0b',
      C: '#3b82f6',
      D: '#22c55e',
      空白: '#9ca3af',
    }
    const PALETTE = ['#a78bfa', '#fb923c', '#14b8a6', '#f472b6', '#94a3b8']

    function choiceColor(option) {
      if (CHOICE_COLORS[option]) return CHOICE_COLORS[option]
      const hash = String(option || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
      return PALETTE[hash % PALETTE.length]
    }

    function pieGradient(options) {
      const slices = options.filter((item) => Number(item.count) > 0)
      const total = slices.reduce((sum, item) => sum + Number(item.count || 0), 0)
      if (!total) return 'var(--dsw-alias-bg-layer-2)'
      let cursor = 0
      return slices
        .map((item) => {
          const start = cursor
          cursor += (Number(item.count || 0) / total) * 360
          return `${choiceColor(item.option)} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`
        })
        .join(', ')
    }

    async function request(op, options = {}) {
      const { timeoutMs = 30000, ...rest } = options
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(API_BASE() + op, { ...rest, cache: 'no-store', signal: controller.signal })
        const text = await response.text()
        let payload = null
        try {
          payload = text ? JSON.parse(text) : null
        } catch {
          payload = null
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || `HTTP ${response.status}`)
        }
        return payload
      } catch (error) {
        if (error.name === 'AbortError') {
          const timeout = new Error('timeout')
          timeout.code = 'TIMEOUT'
          throw timeout
        }
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    function buildTeachingSummaryTable(result) {
      const rows = []
      const add = (table, subject) => {
        const columns = Array.isArray(table?.columns) ? table.columns : []
        const index = columns[0]
        if (!index) return
        for (const row of Array.isArray(table?.data) ? table.data : []) {
          const name = String(row?.[index] ?? '').trim()
          if (!name || name === '总平均值') continue
          const score = Number(row?.[subject])
          if (!Number.isFinite(score)) continue
          rows.push({ 教学班: name, 学科: subject, 均分: Number(score.toFixed(2)) })
        }
      }
      add(result.info_teaching_analysis, '信息')
      add(result.general_teaching_analysis, '通用')
      rows.sort(
        (a, b) =>
          a.教学班.localeCompare(b.教学班, 'zh-Hans-CN', { numeric: true }) ||
          a.学科.localeCompare(b.学科, 'zh-Hans-CN'),
      )
      return { columns: ['教学班', '学科', '均分'], data: rows }
    }

    const tablesOf = (result, grouping, tab) => {
      if (!result) return null
      if (grouping === 'administrative') return result[tab] || null
      if (tab === 'info_analysis') return result.info_teaching_analysis || null
      if (tab === 'general_analysis') return result.general_teaching_analysis || null
      return buildTeachingSummaryTable(result)
    }

    /* ------------------------------------------------------------ 子组件 */

    function Dialog({ dialog, t, onClose }) {
      const inputRef = useRef(null)
      const [value, setValue] = useState('')

      // token 每次打开都不同：重置输入内容并重新聚焦。
      useEffect(() => {
        if (!dialog) return undefined
        setValue(dialog.value ?? '')
        const timer = setTimeout(() => {
          if (dialog.kind !== 'prompt') return
          inputRef.current?.focus()
          inputRef.current?.select()
        }, 0)
        return () => clearTimeout(timer)
      }, [dialog?.token])

      useEffect(() => {
        if (!dialog) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose(null)
          }
          if (event.key === 'Enter' && dialog.kind === 'prompt') {
            event.preventDefault()
            const text = String(value).trim()
            if (text) onClose(text)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [dialog, value, onClose])

      if (!dialog) return null

      return h(
        'div',
        {
          className: 'sax-dialog-backdrop',
          role: 'presentation',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose(null)
          },
        },
        h(
          'div',
          { className: 'sax-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': dialog.title },
          h('h2', null, dialog.title),
          dialog.note ? h('p', null, dialog.note) : null,
          dialog.kind === 'prompt'
            ? h('input', {
                ref: inputRef,
                type: 'text',
                maxLength: 80,
                value,
                onChange: (event) => setValue(event.target.value),
              })
            : null,
          h(
            'div',
            { className: 'sax-dialog-actions' },
            h('button', { type: 'button', className: 'sax-button', onClick: () => onClose(null) }, t('cancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'sax-button primary',
                onClick: () => onClose(dialog.kind === 'prompt' ? String(value).trim() : true),
              },
              t('confirm'),
            ),
          ),
        ),
      )
    }

    function ChoiceTooltip({ tip }) {
      if (!tip) return null
      const { distribution, rect } = tip
      const options = Array.isArray(distribution.options) ? distribution.options : []
      const positive = options.filter((item) => Number(item.count) > 0)
      const style = {
        left: Math.min(Math.max(8, rect.x), Math.max(8, window.innerWidth - 280)),
        top: Math.min(Math.max(8, rect.y), Math.max(8, window.innerHeight - 220)),
      }
      return h(
        'div',
        { className: 'sax-tooltip', style, role: 'tooltip' },
        h('p', { className: 'sax-tip-title' }, distribution.question),
        h('p', { className: 'sax-tip-sub' }, distribution.subtitle),
        positive.length
          ? h(
              'div',
              { className: 'sax-tip-body' },
              h('div', {
                className: 'sax-pie',
                style: { background: `conic-gradient(${pieGradient(positive)})` },
              }),
              h(
                'div',
                { className: 'sax-legend' },
                options.map((item) =>
                  h(
                    'div',
                    { className: 'sax-legend-row', key: item.option },
                    h('span', { className: 'sax-dot', style: { background: choiceColor(item.option) } }),
                    h('span', { className: 'sax-legend-name' }, item.option),
                    h('span', { className: 'sax-legend-value' }, `${item.count} · ${item.percent}%`),
                  ),
                ),
              ),
            )
          : h('p', { className: 'sax-tip-sub' }, distribution.emptyText),
      )
    }

    function ResultTable({ table, result, grouping, tab, t, onHoverChoice, onLeaveChoice }) {
      if (!table || !Array.isArray(table.columns) || !table.data?.length) {
        return h('div', { className: 'sax-empty' }, t('noTableData'))
      }
      const columns = table.columns
      const indexColumn = columns[0]
      const distributions = result?.question_choice_distributions || {}
      const groupColumn = grouping === 'teaching' ? (tab === 'info_analysis' ? '信息教学班' : '通用教学班') : null

      const head = columns.map((column) => {
        const distribution = distributions[column]
        const isChoice = Boolean(distribution)
        return h(
          'th',
          {
            key: column,
            scope: 'col',
            className: isChoice ? 'choice' : undefined,
            tabIndex: isChoice ? 0 : undefined,
            onMouseEnter: isChoice
              ? (event) => onHoverChoice(distribution, event.currentTarget.getBoundingClientRect())
              : undefined,
            onMouseLeave: isChoice ? onLeaveChoice : undefined,
            onFocus: isChoice
              ? (event) => onHoverChoice(distribution, event.currentTarget.getBoundingClientRect())
              : undefined,
            onBlur: isChoice ? onLeaveChoice : undefined,
          },
          column,
        )
      })

      const rows = table.data.map((row, rowIndex) => {
        const name = String(row?.[indexColumn] ?? '').trim()
        const isTotal = name === '总平均值'
        return h(
          'tr',
          { key: `${name}-${rowIndex}`, className: isTotal ? 'total' : undefined },
          columns.map((column) => {
            const raw = row[column]
            const value = typeof raw === 'number' ? Number(raw.toFixed(2)) : raw ?? ''
            const grouped =
              groupColumn && !isTotal
                ? result?.question_choice_distributions_by_group?.[groupColumn]?.[name]?.[column]
                : null
            return h(
              'td',
              {
                key: column,
                onMouseEnter: grouped
                  ? (event) => onHoverChoice(grouped, event.currentTarget.getBoundingClientRect())
                  : undefined,
                onMouseLeave: grouped ? onLeaveChoice : undefined,
              },
              String(value ?? ''),
            )
          }),
        )
      })

      return h(
        'table',
        { className: 'sax-table' },
        h('thead', null, h('tr', null, head)),
        h('tbody', null, rows),
      )
    }

    function AdvicePanel({ result, grouping, tab, t, onHoverChoice, onLeaveChoice }) {
      if (!result) return null
      const advice = result.teachingAdvice || {}
      const lowQuestions = Array.isArray(advice.lowQuestions) ? advice.lowQuestions.slice(0, 5) : []
      const distributions = result.question_choice_distributions || {}

      const weak = (() => {
        const infoTable = grouping === 'teaching' ? result.info_teaching_analysis : result.info_analysis
        const generalTable = grouping === 'teaching' ? result.general_teaching_analysis : result.general_analysis
        const collect = (table, subject) => {
          const columns = Array.isArray(table?.columns) ? table.columns : []
          const index = columns[0]
          if (!index) return []
          return (Array.isArray(table?.data) ? table.data : [])
            .map((row) => ({
              name: String(row?.[index] ?? '').trim(),
              score: Number(row?.[subject]),
              subject,
            }))
            .filter(
              (item) =>
                item.name && item.name !== '总平均值' && item.name !== '台州分校' && Number.isFinite(item.score),
            )
            .sort((a, b) => a.score - b.score)
            .slice(0, 4)
        }
        return { info: collect(infoTable, '信息'), general: collect(generalTable, '通用') }
      })()

      const subjectFilter = tab === 'info_analysis' ? '信息' : tab === 'general_analysis' ? '通用' : null
      const highError = Object.values(distributions)
        .filter((item) =>
          (item.options || []).some(
            (option) => ['A', 'B', 'C', 'D'].includes(String(option.option)) && Number(option.count) > 0,
          ),
        )
        .filter((item) => !subjectFilter || item.subject === subjectFilter)
        .map((item) => ({ ...item, errorRateValue: Number(item.errorRate) }))
        .filter((item) => Number.isFinite(item.errorRateValue))
        .sort((a, b) => b.errorRateValue - a.errorRateValue)
        .slice(0, 6)

      const list = (items, render) =>
        items.length ? items.map(render) : h('div', { className: 'sax-muted' }, t('adviceEmpty'))

      return h(
        'div',
        { className: 'sax-advice' },
        h(
          'div',
          { className: 'sax-advice-box' },
          h('p', { className: 'sax-advice-head' }, t('adviceLow')),
          list(lowQuestions, (item) =>
            h(
              'div',
              { className: 'sax-advice-row', key: `${item.subject}-${item.question}` },
              h('span', null, `${item.subject} · ${item.question}`),
              h('strong', null, formatScore(item.average)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'sax-advice-box' },
          h('p', { className: 'sax-advice-head' }, t('adviceWeak')),
          list([...weak.info, ...weak.general], (item) =>
            h(
              'div',
              { className: 'sax-advice-row', key: `${item.subject}-${item.name}` },
              h('span', null, `${item.subject} · ${item.name}`),
              h('strong', null, formatScore(item.score)),
            ),
          ),
        ),
        h(
          'div',
          { className: 'sax-advice-box' },
          h('p', { className: 'sax-advice-head' }, t('adviceError')),
          highError.length
            ? h(
                'div',
                { className: 'sax-chips' },
                highError.map((item) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sax-chip',
                      key: item.question,
                      onMouseEnter: (event) => onHoverChoice(item, event.currentTarget.getBoundingClientRect()),
                      onMouseLeave: onLeaveChoice,
                      onFocus: (event) => onHoverChoice(item, event.currentTarget.getBoundingClientRect()),
                      onBlur: onLeaveChoice,
                    },
                    `${item.question} ${formatPercent(item.errorRate)}`,
                  ),
                ),
              )
            : h('div', { className: 'sax-muted' }, t('noChoiceData')),
        ),
      )
    }

    /* --------------------------------------------------------------- 页面 */

    function App({ locale, t, initial }) {
      useSyncExternalStore(
        useCallback((fn) => locale.subscribe(fn), [locale]),
        useCallback(() => locale.getSnapshot(), [locale]),
      )

      const [file, setFile] = useState(null)
      const [dragging, setDragging] = useState(false)
      const [result, setResult] = useState(initial?.result ?? null)
      const [currentProject, setCurrentProject] = useState(null)
      const [projects, setProjects] = useState([])
      const [tab, setTab] = useState('class_averages')
      const [grouping, setGrouping] = useState('administrative')
      const [sketch, setSketch] = useState('')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [tip, setTip] = useState(null)
      const [mappingSource, setMappingSource] = useState('')
      const [dialog, setDialog] = useState(null)
      const dialogResolve = useRef(null)
      const fileInput = useRef(null)
      const mappingInput = useRef(null)
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const notify = useCallback((message) => {
        setError('')
        setNotice(message)
      }, [])

      const fail = useCallback((message) => {
        setNotice('')
        setError(message)
      }, [])

      const loadProjects = useCallback(async () => {
        try {
          const payload = await request('projects')
          if (mounted.current) setProjects(Array.isArray(payload.projects) ? payload.projects : [])
        } catch {
          if (mounted.current) setProjects([])
        }
      }, [])

      useEffect(() => {
        loadProjects()
      }, [loadProjects])

      const openDialog = useCallback((next) => {
        setDialog({ ...next, token: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}` })
        return new Promise((resolve) => {
          dialogResolve.current = resolve
        })
      }, [])

      const closeDialog = useCallback((value) => {
        setDialog(null)
        const resolve = dialogResolve.current
        dialogResolve.current = null
        if (resolve) resolve(value)
      }, [])

      const pickFile = (next) => {
        setError('')
        setNotice('')
        if (!next) {
          setFile(null)
          return
        }
        if (!/\.(xls|xlsx|zip)$/i.test(next.name || '')) {
          setFile(null)
          fail(t('unsupported'))
          return
        }
        setFile(next)
        if (/\.(xls|xlsx)$/i.test(next.name) && /(分班|汇总表)/.test(next.name) && !/小题分/.test(next.name)) {
          fail(t('hintClassSheet'))
          return
        }
        if (/\.zip$/i.test(next.name)) setNotice(t('hintZip'))
      }

      const analyze = async () => {
        if (!file || busy) return
        setBusy('analyze')
        setError('')
        setNotice('')
        try {
          const form = new FormData()
          form.append('file', file, file.name)
          const payload = await request('analyze', { method: 'POST', body: form, timeoutMs: 300000 })
          if (!mounted.current) return
          setResult(payload)
          setCurrentProject(null)
          setTab('class_averages')
          setGrouping('administrative')
          setMappingSource(payload.mappingSource || '')
          const classCount = (payload.class_averages?.data || []).length
          notify(t('analysisDone', { questions: payload.summary?.question_count ?? 0, classes: classCount }))
          loadProjects()
        } catch (e) {
          if (mounted.current) fail(e.code === 'TIMEOUT' ? t('timeout') : `${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const importMapping = async () => {
        const picked = mappingInput.current?.files?.[0]
        if (!picked) return
        setBusy('mapping')
        setError('')
        setNotice('')
        try {
          const form = new FormData()
          form.append('mapping', picked, picked.name)
          const payload = await request('mapping', { method: 'POST', body: form, timeoutMs: 60000 })
          if (!mounted.current) return
          setMappingSource(payload.mappingSource || picked.name)
          if (mappingInput.current) mappingInput.current.value = ''
          notify(payload.mappingSource || picked.name)
        } catch (e) {
          if (mounted.current) fail(`${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const saveProject = async (name) => {
        if (!result || busy) return
        setBusy('save')
        try {
          const payload = await request('projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, result }),
          })
          if (!mounted.current) return
          setCurrentProject(payload.project)
          notify(t('savedProject'))
          await loadProjects()
        } catch (e) {
          if (mounted.current) fail(`${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const renameProject = async (name) => {
        if (!currentProject || busy) return
        setBusy('rename')
        try {
          const payload = await request(`projects/${encodeURIComponent(currentProject.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          })
          if (!mounted.current) return
          setCurrentProject(payload.project)
          setResult(payload.project.result)
          notify(t('renamed'))
          await loadProjects()
        } catch (e) {
          if (mounted.current) fail(`${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const deleteProject = async (project) => {
        if (busy) return
        setBusy('delete')
        try {
          await request('projects', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: project.id }),
          })
          if (!mounted.current) return
          if (currentProject?.id === project.id) {
            setCurrentProject(null)
            setResult(null)
          }
          notify(t('deletedProject'))
          await loadProjects()
        } catch (e) {
          if (mounted.current) fail(`${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const openProject = async (project) => {
        if (busy) return
        setBusy('open')
        try {
          const payload = await request(`projects/${encodeURIComponent(project.id)}`)
          if (!mounted.current) return
          setResult(payload.project.result)
          setCurrentProject(payload.project)
          setMappingSource(payload.project.result?.mappingSource || '')
          setError('')
          setNotice('')
        } catch (e) {
          if (mounted.current) fail(`${t('errorPrefix')}${e.message}`)
        } finally {
          if (mounted.current) setBusy('')
        }
      }

      const download = (kind) => {
        if (!result) return
        const base = API_BASE()
        let url
        if (kind === 'workbook') {
          if (!result.outputFilename) return
          const name = encodeURIComponent(result.downloadFilename || 'analysis.xlsx')
          url = `${base}download/${encodeURIComponent(result.outputFilename)}?name=${name}`
        } else {
          const filename = String(result.reportCardsFilename || '')
          if (!filename) return
          const name = encodeURIComponent(result.reportCardsDownloadFilename || '成绩单.zip')
          const threshold = sketch.trim()
          url =
            `${base}report-cards/${encodeURIComponent(filename)}?name=${name}` +
            (threshold ? `&sketchThreshold=${encodeURIComponent(threshold)}` : '')
        }
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.rel = 'noopener'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      }

      const hoverChoice = useCallback((distribution, rect) => {
        const options = Array.isArray(distribution?.options) ? distribution.options : []
        const parts = [
          distribution.subject || '',
          `${t('average', { value: formatScore(distribution.averageScore) })}`,
        ]
        if (Number.isFinite(Number(distribution.errorRate))) {
          parts.push(t('errorRate', { value: formatPercent(distribution.errorRate) }))
        }
        parts.push(t('answered', { answered: distribution.answered ?? 0, total: distribution.total ?? 0 }))
        setTip({
          distribution: {
            ...distribution,
            subtitle: parts.filter(Boolean).join(' · '),
            emptyText: t('noChoiceData'),
          },
          rect: { x: rect.right + 10, y: rect.top },
        })
      }, [t])
      const leaveChoice = useCallback(() => setTip(null), [])

      useEffect(() => {
        if (!tip) return undefined
        const hide = () => setTip(null)
        window.addEventListener('scroll', hide, true)
        window.addEventListener('resize', hide)
        return () => {
          window.removeEventListener('scroll', hide, true)
          window.removeEventListener('resize', hide)
        }
      }, [tip])

      const table = useMemo(() => tablesOf(result, grouping, tab), [result, grouping, tab])
      const summary = result?.summary || {}
      const warnings = Array.isArray(result?.warnings) ? result.warnings : []
      const hasTeaching = Boolean(
        result?.info_teaching_analysis?.data?.length || result?.general_teaching_analysis?.data?.length,
      )
      const hasReportCards = Boolean(result?.reportCardsUrl)
      const tabs = [
        ['class_averages', t('tabClass'), (result?.class_averages?.data || []).length],
        ['info_analysis', t('tabInfo'), (result?.info_analysis?.data || []).length],
        ['general_analysis', t('tabGeneral'), (result?.general_analysis?.data || []).length],
      ]
      const canAnalyze = Boolean(file) && !busy

      return h(
        'section',
        { className: 'sax', 'aria-label': t('title'), 'data-version': VERSION },
        h('style', { 'data-plugin': NS }, CSS),
        h(
          'header',
          { className: 'sax-header' },
          h(PanelIcon, { size: 18 }),
          h('h1', null, t('title')),
          h('span', { className: 'sax-version' }, `v${VERSION}`),
          h('div', { className: 'sax-grow' }),
          h('span', { className: 'sax-sub' }, t('subtitle')),
          h(
            'span',
            { className: 'sax-muted', title: mappingSource || t('mappingUnset') },
            `${t('mapping')} · ${mappingSource || t('mappingUnset')}`,
          ),
        ),
        h(
          'div',
          { className: 'sax-body' },
          /* 左侧：上传 + 映射 + 项目 */
          h(
            'aside',
            { className: 'sax-side' },
            h(
              'div',
              { className: 'sax-card' },
              h(
                'div',
                { className: 'sax-card-head' },
                h('p', { className: 'sax-card-title' }, t('uploadTitle')),
                h('div', { className: 'sax-grow' }),
                h('span', { className: 'sax-muted' }, t('uploadHint')),
              ),
              h(
                'div',
                { className: 'sax-card-body' },
                h(
                  'div',
                  {
                    className: 'sax-drop',
                    role: 'button',
                    tabIndex: 0,
                    'data-active': dragging,
                    onClick: () => fileInput.current?.click(),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        fileInput.current?.click()
                      }
                    },
                    onDragOver: (event) => {
                      event.preventDefault()
                      setDragging(true)
                    },
                    onDragLeave: () => setDragging(false),
                    onDrop: (event) => {
                      event.preventDefault()
                      setDragging(false)
                      pickFile(event.dataTransfer?.files?.[0] || null)
                    },
                  },
                  h(Icon, { size: 22, path: ICONS.upload }),
                  h('strong', null, dragging ? t('dropActive') : t('dropHere')),
                  h('span', { className: 'sax-drop-name' }, file ? file.name : t('noFile')),
                  h('input', {
                    ref: fileInput,
                    type: 'file',
                    accept: '.xls,.xlsx,.zip',
                    style: { display: 'none' },
                    onChange: (event) => pickFile(event.target.files?.[0] || null),
                  }),
                ),
                h(
                  'div',
                  { className: 'sax-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sax-button primary',
                      disabled: !canAnalyze,
                      onClick: analyze,
                    },
                    h(Icon, { size: 15, path: ICONS.upload }),
                    busy === 'analyze' ? t('analyzing') : t('analyze'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sax-button',
                      disabled: Boolean(busy),
                      onClick: () => {
                        pickFile(null)
                        if (fileInput.current) fileInput.current.value = ''
                        setNotice('')
                        setError('')
                      },
                    },
                    t('clear'),
                  ),
                ),
                error ? h('div', { className: 'sax-status err', role: 'alert' }, error) : null,
                notice ? h('div', { className: 'sax-status ok', role: 'status' }, notice) : null,
              ),
            ),
            h(
              'div',
              { className: 'sax-card' },
              h(
                'div',
                { className: 'sax-card-head' },
                h('p', { className: 'sax-card-title' }, t('mapping')),
                h('div', { className: 'sax-grow' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sax-button ghost',
                    disabled: Boolean(busy),
                    onClick: () => mappingInput.current?.click(),
                  },
                  busy === 'mapping' ? t('loading') : t('mappingImport'),
                ),
                h('input', {
                  ref: mappingInput,
                  type: 'file',
                  accept: '.xls,.xlsx',
                  style: { display: 'none' },
                  onChange: importMapping,
                }),
              ),
              h(
                'div',
                { className: 'sax-card-body' },
                h('div', { className: 'sax-muted' }, mappingSource || t('mappingUnset')),
                h('div', { className: 'sax-muted' }, t('mappingHint')),
              ),
            ),
            h(
              'div',
              { className: 'sax-card' },
              h(
                'div',
                { className: 'sax-card-head' },
                h('p', { className: 'sax-card-title' }, t('projects')),
                h('div', { className: 'sax-grow' }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sax-button ghost',
                    onClick: () => loadProjects(),
                    disabled: Boolean(busy),
                  },
                  t('refresh'),
                ),
              ),
              h(
                'div',
                { className: 'sax-card-body' },
                projects.length
                  ? h(
                      'div',
                      { className: 'sax-projects' },
                      projects.map((project) =>
                        h(
                          'div',
                          {
                            className: 'sax-project',
                            key: project.id,
                            'data-active': currentProject?.id === project.id,
                          },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'sax-open',
                              onClick: () => openProject(project),
                              title: project.sourceFilename || project.name,
                            },
                            h('span', { className: 'sax-project-name' }, project.name),
                            h('span', { className: 'sax-project-date' }, formatDate(project.updatedAt)),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'sax-button ghost sax-remove',
                              'aria-label': `${t('remove')} ${project.name}`,
                              onClick: async () => {
                                const confirmed = await openDialog({
                                  kind: 'confirm',
                                  title: t('deleteTitle'),
                                  note: `${project.name} · ${t('deletePrompt')}`,
                                })
                                if (confirmed) deleteProject(project)
                              },
                            },
                            h(Icon, { size: 13, path: ICONS.close }),
                          ),
                        ),
                      ),
                    )
                  : h('div', { className: 'sax-muted' }, t('projectEmpty')),
                h(
                  'div',
                  { className: 'sax-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'sax-button',
                      disabled: !result || Boolean(busy),
                      onClick: async () => {
                        const suggested =
                          String(result?.downloadFilename || '').replace(/\.xlsx$/i, '') || '未命名考试'
                        const name = await openDialog({
                          kind: 'prompt',
                          title: t('projectName'),
                          note: t('saveNamePrompt'),
                          value: suggested,
                        })
                        if (name) saveProject(String(name).trim())
                      },
                    },
                    h(Icon, { size: 14, path: ICONS.file }),
                    busy === 'save' ? t('projectSaving') : t('projectSave'),
                  ),
                  currentProject
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'sax-button',
                          disabled: Boolean(busy),
                          onClick: async () => {
                            const name = await openDialog({
                              kind: 'prompt',
                              title: t('projectName'),
                              note: t('saveNamePrompt'),
                              value: currentProject.name,
                            })
                            if (name) renameProject(String(name).trim())
                          },
                        },
                        t('rename'),
                      )
                    : null,
                ),
              ),
            ),
          ),
          /* 右侧：结果 */
          h(
            'div',
            { className: 'sax-main' },
            h(
              'div',
              { className: 'sax-card', style: { flex: 1, minHeight: 0 } },
              h(
                'div',
                { className: 'sax-card-head' },
                h('p', { className: 'sax-card-title' }, t('result')),
                h('div', { className: 'sax-grow' }),
                result
                  ? h(
                      'span',
                      { className: 'sax-muted' },
                      [
                        result.sourceFilename || '',
                        hasReportCards ? t('reportCardsCount', { count: result.report_cards_count ?? 0 }) : '',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    )
                  : null,
              ),
              h(
                'div',
                { className: 'sax-card-body', style: { flex: 1, minHeight: 0, gap: 10 } },
                result
                  ? [
                      h(
                        'div',
                        { className: 'sax-kpis', key: 'kpis' },
                        [
                          ['sumQuestions', summary.question_count],
                          ['sumInfo', summary.info_question_count],
                          ['sumGeneral', summary.general_question_count],
                          ['sumUnknown', summary.unclassified_question_count],
                        ].map(([label, value]) =>
                          h(
                            'div',
                            { className: 'sax-kpi', key: label },
                            h('span', { className: 'sax-kpi-value' }, String(value ?? 0)),
                            h('span', { className: 'sax-kpi-label' }, t(label)),
                          ),
                        ),
                      ),
                      h(AdvicePanel, {
                        key: 'advice',
                        result,
                        grouping,
                        tab,
                        t,
                        onHoverChoice: hoverChoice,
                        onLeaveChoice: leaveChoice,
                      }),
                      h(
                        'div',
                        { className: 'sax-tabs', key: 'tabs' },
                        tabs.map(([key, label, count]) =>
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'sax-tab',
                              key,
                              'aria-pressed': tab === key,
                              onClick: () => setTab(key),
                            },
                            label,
                            h('span', { className: 'sax-count' }, count || ''),
                          ),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'sax-toolbar', key: 'toolbar' },
                        h(
                          'div',
                          { className: 'sax-segment', role: 'group' },
                          h(
                            'button',
                            {
                              type: 'button',
                              'aria-pressed': grouping === 'administrative',
                              onClick: () => setGrouping('administrative'),
                            },
                            t('groupAdmin'),
                          ),
                          h(
                            'button',
                            {
                              type: 'button',
                              'aria-pressed': grouping === 'teaching',
                              disabled: !hasTeaching,
                              onClick: () => setGrouping('teaching'),
                            },
                            t('groupTeaching'),
                          ),
                        ),
                        h('div', { className: 'sax-grow' }),
                        hasReportCards
                          ? h(
                              'label',
                              { className: 'sax-threshold' },
                              t('sketchLabel'),
                              h('input', {
                                type: 'number',
                                min: '0',
                                step: '0.1',
                                inputMode: 'decimal',
                                placeholder: '5',
                                value: sketch,
                                onChange: (event) => setSketch(event.target.value),
                              }),
                              t('sketchSuffix'),
                            )
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'sax-button',
                            onClick: () => download('workbook'),
                            disabled: !result.outputFilename,
                          },
                          h(Icon, { size: 14, path: ICONS.download }),
                          t('downloadWorkbook'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'sax-button primary',
                            onClick: () => download('cards'),
                            disabled: !hasReportCards,
                          },
                          h(Icon, { size: 14, path: ICONS.download }),
                          t('downloadCards'),
                        ),
                      ),
                      warnings.length || result.reportCardsError
                        ? h(
                            'div',
                            { className: 'sax-warnings', key: 'warnings' },
                            result.reportCardsError
                              ? h(
                                  'div',
                                  { key: 'report-cards' },
                                  t('cardsUnavailable', { reason: result.reportCardsError }),
                                )
                              : null,
                            warnings.slice(0, 6).map((warning, index) => h('div', { key: index }, warning)),
                          )
                        : null,
                      h(
                        'div',
                        { className: 'sax-scroll', key: 'table' },
                        h(ResultTable, {
                          table,
                          result,
                          grouping,
                          tab,
                          t,
                          onHoverChoice: hoverChoice,
                          onLeaveChoice: leaveChoice,
                        }),
                      ),
                    ]
                  : h('div', { className: 'sax-empty' }, busy === 'analyze' ? t('analyzing') : t('empty')),
              ),
            ),
          ),
        ),
        h(
          'footer',
          { className: 'sax-footer' },
          h(
            'span',
            null,
            `${t('sourceFile')} · ${result ? result.sourceFilename || '-' : file?.name || t('noFile')}`,
          ),
          result?.extractedEntryName
            ? h('span', { title: result.extractedEntryName }, `↳ ${result.extractedEntryName.split('/').pop()}`)
            : null,
          h('div', { className: 'sax-grow' }),
          result?.createdAt ? h('span', null, t('savedAt', { time: result.createdAt })) : null,
        ),
        h(ChoiceTooltip, { tip }),
        h(Dialog, { dialog, t, onClose: closeDialog }),
      )
    }

    /* -------------------------------------------------------------- 注册 */

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(`${NS}-ui`, 'zh', dictionaries.zh))
        ctx.effect(() => ctx.locale.register(`${NS}-ui`, 'en', dictionaries.en))
        const t = ctx.locale.bind(`${NS}-ui`)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: NS, order: 24, label: () => t('title') },
            PanelIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS }, (props) =>
            h(App, { ...props, locale: ctx.locale, t }),
          ),
        )
      },
    }
  },
})
