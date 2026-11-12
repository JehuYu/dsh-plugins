/* ==========================================================================
   Sanview Studio · Harness 内嵌桥接
   --------------------------------------------------------------------------
   Host 在返回 index.html 时注入本脚本。独立打开（非内嵌）时它什么都不做，
   所以同一份 dist/ 仍然可以单独部署。

   它解决三件事：
     1. 主题同步：内嵌时页面被 Harness 的主题（亮色 / 暗色 / 自定义皮肤）包住，
        而 prefers-color-scheme 只反映系统设置。这里从父页面读取 --dsw-* token，
        写进本文档的 :root，使两边颜色完全一致。
     2. 键盘可达：iframe 需要焦点才收键盘事件。面板挂载后父页面会发一条
        { type: 'sanview:focus' }，这里把焦点交给画布容器。
     3. 视口刷新：面板尺寸变化时通知绘图应用重新适配画布。
   ========================================================================== */
(function () {
  'use strict'

  var embedded = window.parent && window.parent !== window
  if (!embedded) return

  // 标记「我在 Harness 里」。样式层据此收掉与宿主重复的元素（例如品牌名）。
  document.documentElement.setAttribute('data-dsh-embedded', '')

  /* ------------------------------------------------------------ 主题同步 */
  var TOKENS = [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-bg-overlay',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-brand-primary',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-idle-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-specific-sidebar-fill',
  ]

  var root = document.documentElement
  var lastScheme = ''

  function parentRoot() {
    try {
      var doc = window.parent.document
      return doc && doc.documentElement
    } catch (error) {
      return null
    }
  }

  /** 把父页面的 token 镜像到本文档；父页面不可读时保留自身回退。 */
  function syncTheme() {
    var source = parentRoot()
    if (!source) return false

    var styles
    try {
      styles = window.parent.getComputedStyle(source)
    } catch (error) {
      return false
    }
    if (!styles) return false

    var written = 0
    for (var i = 0; i < TOKENS.length; i++) {
      var name = TOKENS[i]
      var value = styles.getPropertyValue(name)
      if (!value || !value.trim()) continue
      root.style.setProperty(name, value.trim())
      written++
    }

    // 亮 / 暗由父页面生效的底色调性决定：取 bg-base 的亮度即可，
    // 比 data-theme 属性可靠（自定义皮肤不一定带这个属性）。
    var base = styles.getPropertyValue('--dsw-alias-bg-base') || ''
    var scheme = schemeOf(base) || schemeOf(styles.colorScheme || '') || 'light'
    if (scheme && scheme !== lastScheme) {
      lastScheme = scheme
      root.style.setProperty('color-scheme', scheme)
      root.setAttribute('data-dsw-scheme', scheme)
    }
    return written > 0
  }

  /** 从 `#rrggbb` / `#rgb` / `rgb(...)` / `light` 这类取值推断亮暗。 */
  function schemeOf(value) {
    var text = String(value || '').trim().toLowerCase()
    if (!text) return ''
    if (text.indexOf('dark') >= 0) return 'dark'
    if (text.indexOf('light') >= 0) return 'light'
    var hex = /^#([0-9a-f]{3,8})$/.exec(text)
    if (hex) {
      var digits = hex[1]
      if (digits.length === 3) digits = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
      if (digits.length < 6) return ''
      var r = parseInt(digits.slice(0, 2), 16)
      var g = parseInt(digits.slice(2, 4), 16)
      var b = parseInt(digits.slice(4, 6), 16)
      return r * 0.299 + g * 0.587 + b * 0.114 < 128 ? 'dark' : 'light'
    }
    var rgb = /^rgba?\(([^)]+)\)$/.exec(text)
    if (rgb) {
      var parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length >= 3 && parts.slice(0, 3).every(function (n) { return isFinite(n) })) {
        return parts[0] * 0.299 + parts[1] * 0.587 + parts[2] * 0.114 < 128 ? 'dark' : 'light'
      }
    }
    return ''
  }

  syncTheme()

  // 父页面换主题时第一时间跟随：监听 class / style / data-* 的属性变化。
  var parent = parentRoot()
  if (parent && typeof MutationObserver === 'function') {
    try {
      new MutationObserver(syncTheme).observe(parent, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'lang'],
      })
    } catch (error) {
      /* 跨源或不可观察，退回轮询 */
    }
  }
  // 轮询是兜底：token 也可能因皮肤设置重算而不改属性。开销可忽略。
  var timer = window.setInterval(syncTheme, 1500)
  window.addEventListener('pagehide', function () { window.clearInterval(timer) })

  /* --------------------------------------------------------- 尺寸与焦点 */
  function refit() {
    try {
      window.dispatchEvent(new Event('resize'))
    } catch (error) {
      /* 忽略 */
    }
  }

  if (typeof ResizeObserver === 'function') {
    var pending = 0
    try {
      new ResizeObserver(function () {
        // 拖动 Harness 侧栏时会连续触发，合并到下一帧，避免重复适配。
        if (pending) return
        pending = window.requestAnimationFrame(function () {
          pending = 0
          refit()
        })
      }).observe(document.body)
    } catch (error) {
      /* 忽略 */
    }
  }

  function focusCanvas() {
    var target =
      document.getElementById('viewport') ||
      document.querySelector('.canvas-area') ||
      document.body
    try {
      if (target && typeof target.focus === 'function') {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      }
    } catch (error) {
      /* 忽略 */
    }
  }

  /**
   * 让应用立刻落盘。面板被卸载时浏览器不保证触发 pagehide，但应用自己已经在
   * 监听它来做「最后一次保存」；这里只是把那一刻提前到卸载之前。
   */
  function flush() {
    try {
      window.dispatchEvent(new Event('pagehide'))
    } catch (error) {
      /* 忽略 */
    }
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data
    if (!data || typeof data !== 'object') return
    if (data.type === 'sanview:focus') focusCanvas()
    if (data.type === 'sanview:refit') refit()
    if (data.type === 'sanview:theme') syncTheme()
    if (data.type === 'sanview:flush') flush()
  })

  // 首帧后自检一次：父页面 token 若晚于本脚本就位，这里补上。
  window.requestAnimationFrame(function () {
    syncTheme()
    window.setTimeout(syncTheme, 120)
  })
})()
