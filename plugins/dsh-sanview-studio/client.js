window.__ModuleLoader__.load({
  id: '@local/dsh-sanview-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'sanview-studio'

    /* ------------------------------------------------------------ 文案 */

    const ZH = {
      title: '三视图',
      booting: '正在打开三视图工作台',
      failedTitle: '工作台没有响应',
      failedBody:
        '插件已加载，但没能取到三视图的页面。请确认插件配置里的 distPath 指向项目中的 dist 目录。',
      retry: '重新载入',
      openExternal: '在新标签页打开',
      route: '路由：',
      frameTitle: '三视图工作台',
    }

    const EN = {
      title: 'Sanview Studio',
      booting: 'Opening the drafting workspace',
      failedTitle: 'The workspace did not respond',
      failedBody:
        'The plugin loaded but could not reach the Sanview page. Point distPath at the project dist directory.',
      retry: 'Reload',
      openExternal: 'Open in a new tab',
      route: 'Route: ',
      frameTitle: 'Sanview Studio workspace',
    }

    /** 语言包随激活注册；在语言服务缺席时退回中文，界面不会空着。 */
    function translator(ctx) {
      let lookup = null
      try {
        const locale = ctx.get ? ctx.get('locale') : undefined
        if (locale && typeof locale.bind === 'function') lookup = locale.bind(NS)
      } catch (error) {
        lookup = null
      }
      return (key) => {
        if (lookup) {
          try {
            const text = lookup(key)
            // 语言服务在缺少词条时回显 key 本身，这时仍退回本地默认文案。
            if (text && text !== key) return text
          } catch (error) {
            /* 语言服务异常时不要连界面一起丢掉 */
          }
        }
        return ZH[key] ?? key
      }
    }

    /** 工作台由 Host 半端挂在 <basePath>/ 上；这里跟随页面基准地址解析。 */
    function workspaceUrl() {
      try {
        return new URL('sanview-studio/', document.baseURI).href
      } catch (error) {
        return '/sanview-studio/'
      }
    }

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.sv-root{box-sizing:border-box;position:relative;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);overflow:hidden}
.sv-frame{position:relative;flex:1;min-height:0;background:var(--dsw-alias-bg-base)}
.sv-iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:inherit}
.sv-iframe.is-hidden{visibility:hidden}

/* 载入骨架：与工作台同样的中性底，一条细的进度线，不加遮罩噪音 */
.sv-boot{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--dsw-alias-bg-base);transition:opacity .28s cubic-bezier(.22,1,.36,1)}
.sv-boot.is-out{opacity:0;pointer-events:none}
.sv-boot-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary)}
.sv-boot-mark svg{width:22px;height:22px}
.sv-boot-mark svg path,.sv-boot-mark svg line,.sv-boot-mark svg circle{animation:sv-draw 1.6s cubic-bezier(.4,0,.2,1) infinite;transform-origin:center}
.sv-boot-mark svg path:nth-child(2){animation-delay:.16s}
.sv-boot-mark svg path:nth-child(3){animation-delay:.32s}
@keyframes sv-draw{0%,100%{opacity:.28}50%{opacity:1}}
.sv-boot-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);letter-spacing:.01em}
.sv-boot-bar{position:relative;width:132px;height:2px;border-radius:99px;background:var(--dsw-alias-border-l1);overflow:hidden}
.sv-boot-bar i{position:absolute;inset:0 auto 0 0;width:40%;border-radius:99px;background:var(--dsw-alias-brand-primary);animation:sv-slide 1.25s cubic-bezier(.4,0,.2,1) infinite}
@keyframes sv-slide{0%{left:-40%}100%{left:100%}}

/* 失败态：说明原因与下一步，不假装成功 */
.sv-error{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:32px;background:var(--dsw-alias-bg-base)}
.sv-error-card{box-sizing:border-box;width:min(430px,100%);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);padding:20px 22px 18px;box-shadow:0 12px 32px -18px rgba(0,0,0,.28)}
.sv-error-head{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.sv-error-head svg{width:17px;height:17px;flex:none;color:var(--dsw-alias-state-error-primary)}
.sv-error-head b{font-size:13.5px;font-weight:600;letter-spacing:-.01em}
.sv-error p{margin:0 0 14px;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.sv-error code{font:11px/1.6 var(--dsw-font-mono,ui-monospace,monospace);padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.sv-error-actions{display:flex;gap:8px;flex-wrap:wrap}
.sv-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;transition:background-color .16s,border-color .16s,color .16s}
.sv-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.sv-btn.pri{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;font-weight:550}
.sv-btn.pri:hover{filter:brightness(1.05)}
.sv-btn svg{width:13px;height:13px}
.sv-hint{margin-top:12px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary)}

@media (prefers-reduced-motion:reduce){.sv-boot-mark svg path,.sv-boot-mark svg line,.sv-boot-bar i{animation:none}.sv-boot,.sv-appear{transition:none}}
.sv-appear{animation:sv-appear .3s cubic-bezier(.22,1,.36,1) both}
@keyframes sv-appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`

    /* ------------------------------------------------------------ 图标 */

    /** 侧栏图标：三视图的「主 / 俯 / 左」三框 + 一道尺寸线。 */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      const stroke = 'currentColor'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', { x: 2.6, y: 3.2, width: 9, height: 7.4, rx: 1.2, stroke, strokeWidth: 1.6 }),
        h('rect', { x: 14.2, y: 3.2, width: 7.2, height: 7.4, rx: 1.2, stroke, strokeWidth: 1.6, opacity: 0.55 }),
        h('rect', { x: 2.6, y: 13.4, width: 9, height: 7.4, rx: 1.2, stroke, strokeWidth: 1.6, opacity: 0.55 }),
        h('path', {
          d: 'M14.2 17.1h7.2M14.2 17.1v-2.4M21.4 17.1v-2.4',
          stroke,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ------------------------------------------------------------ 页面 */

    function StudioPanel({ t = (key) => ZH[key] ?? key }) {
      const [phase, setPhase] = useState('loading') // loading | ready | error
      const [attempt, setAttempt] = useState(0)
      const frame = useRef(null)
      const url = useMemo(workspaceUrl, [])

      const reload = useCallback(() => {
        setPhase('loading')
        setAttempt((n) => n + 1)
      }, [])

      // iframe 的 load 事件在 404 页面也会触发，所以用一次探测确认工作台真的在。
      useEffect(() => {
        let alive = true
        setPhase('loading')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 12000)
        fetch(`${url}index.html`, { method: 'GET', cache: 'no-store', signal: controller.signal })
          .then((res) => {
            if (!alive) return
            if (!res.ok) {
              setPhase('error')
              return
            }
            setPhase('ready')
          })
          .catch(() => {
            if (alive) setPhase('error')
          })
          .finally(() => clearTimeout(timer))
        return () => {
          alive = false
          clearTimeout(timer)
          controller.abort()
        }
      }, [url, attempt])

      // 键盘事件需要一个有焦点的文档；把焦点交给工作台画布。
      const onFrameLoad = useCallback(() => {
        try {
          frame.current?.contentWindow?.postMessage({ type: 'sanview:focus' }, '*')
          frame.current?.contentWindow?.postMessage({ type: 'sanview:theme' }, '*')
        } catch (error) {
          /* 跨源时忽略 */
        }
      }, [])

      // iframe 已经存在时（切回本面板不会重新加载），点面板任意空白处也把焦点交回去。
      const focusFrame = useCallback(() => {
        try {
          const win = frame.current?.contentWindow
          if (!win) return
          win.focus()
          win.postMessage({ type: 'sanview:focus' }, '*')
        } catch (error) {
          /* 跨源时忽略 */
        }
      }, [])

      // 面板卸载前请应用把当前图纸落盘，避免「画完就切走」丢掉最后一步。
      useEffect(() => {
        const node = frame.current
        return () => {
          try {
            node?.contentWindow?.postMessage({ type: 'sanview:flush' }, '*')
          } catch (error) {
            /* 跨源时忽略 */
          }
        }
      }, [])

      const frameProps = {
        ref: frame,
        key: attempt,
        src: url,
        title: t('frameTitle'),
        className: `sv-iframe${phase === 'ready' ? '' : ' is-hidden'}`,
        allow: 'clipboard-write; clipboard-read',
        onLoad: onFrameLoad,
      }

      return h(
        'div',
        { className: 'sv-root' },
        h('style', { 'data-plugin': NS }, CSS),
        h(
          'div',
          { className: 'sv-frame', onPointerDown: focusFrame },
          h('iframe', frameProps),
          phase === 'loading'
            ? h(
                'div',
                { className: 'sv-boot' },
                h(
                  'div',
                  { className: 'sv-boot-mark' },
                  h(
                    'svg',
                    { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
                    h('path', { d: 'M4 4.6h7v5.4H4z', stroke: 'currentColor', strokeWidth: 1.6 }),
                    h('path', { d: 'M13.6 4.6H20v5.4h-6.4z', stroke: 'currentColor', strokeWidth: 1.6 }),
                    h('path', { d: 'M4 13.6h7V19H4z', stroke: 'currentColor', strokeWidth: 1.6 }),
                  ),
                ),
                h('div', { className: 'sv-boot-text' }, t('booting')),
                h('div', { className: 'sv-boot-bar' }, h('i')),
              )
            : null,
          phase === 'error'
            ? h(
                'div',
                { className: 'sv-error', role: 'alert' },
                h(
                  'div',
                  { className: 'sv-error-card sv-appear' },
                  h(
                    'div',
                    { className: 'sv-error-head' },
                    h(
                      'svg',
                      { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
                      h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.6 }),
                      h('path', { d: 'M12 7.6v5.2m0 3.1h.01', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
                    ),
                    h('b', null, t('failedTitle')),
                  ),
                  h('p', null, t('failedBody')),
                  h(
                    'div',
                    { className: 'sv-error-actions' },
                    h(
                      'button',
                      { type: 'button', className: 'sv-btn pri', onClick: reload },
                      h(
                        'svg',
                        { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
                        h('path', { d: 'M4 10a8 8 0 1 1 1.8 7M4 4v6h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
                      ),
                      t('retry'),
                    ),
                    h(
                      'a',
                      {
                        className: 'sv-btn',
                        href: url,
                        target: '_blank',
                        rel: 'noreferrer',
                        style: { textDecoration: 'none' },
                      },
                      t('openExternal'),
                    ),
                  ),
                  h('div', { className: 'sv-hint' }, `${t('route')}${url}`),
                ),
              )
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------ 注册 */

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        const t = translator(ctx)
        ctx.effect(() => {
          const locale = ctx.get ? ctx.get('locale') : undefined
          if (!locale) return () => {}
          const offZh = locale.register(NS, 'zh', ZH)
          const offEn = locale.register(NS, 'en', EN)
          return () => {
            offZh()
            offEn()
          }
        }, 'sanview-studio: dictionaries')

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: NS, order: 34, label: () => t('title') },
            (props) => h(PanelIcon, props),
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS, label: () => t('title') }, () =>
            h(StudioPanel, { t }),
          ),
        )
      },
    }
  },
})
