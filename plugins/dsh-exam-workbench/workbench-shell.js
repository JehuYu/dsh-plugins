/** Combined UI; the build embeds this function in the one browser module. */
export function createUnifiedPlugin({ React, App: GradingApp, WorkbenchBoundary, Icon, createArchiveView }) {
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
