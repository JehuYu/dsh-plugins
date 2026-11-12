/**
 * ameqp.js — Read-only AMEQP client in pure Node (no Python, no native deps).
 *
 * Mirrors the reviewed `ameqp_readonly.py` allowlist. Login uses the site's
 * DES wire format, implemented with Node crypto in login-cipher.js.
 * Read queries are allowlisted. Claim/submit/cancel additionally require the
 * explicit productionMarking switch; requests have bounded timeouts.
 */
import { encMe } from './login-cipher.js'

// Reviewed read-only query allowlist (path -> { param -> allowed values }).
// 阅卷会话只读元数据（GetSessionId / GetDefQuestion / GetDefQuestionInfo）不占卷、不写回。
// 注意：GetQuestion（领卷，会占卷）、SubmitScore（写分）、GetCancel（释放卷）默认不在此白名单内；
// 仅当配置 ameqpBase 打开「正式阅卷」开关时才允许。见 index.js 的 productionMarking 开关。
const ALLOWED = {
  'Webroot/Control/Top_SearchHandler.ashx': { type: ['getExamNoFinish', 'getExamSub', 'getExamQuestion'] },
  'Webroot/Exa_ashx/Exa_ExamHandler.ashx': { type: ['getPaging'] },
  'Webroot/def_ashx/Def_AnswerHandler.ashx': { type: ['getPaging', 'getHaveStudentMarQuestion', 'getStuImgList', 'getConPar', 'getStuMsg'] },
  'Webroot/sco_ashx/Sco_StuAnsImgHandler.ashx': { type: ['getimgandque'] },
  'Webroot/ans_ashx/AnsQuestionHandler.ashx': { op: ['GetSessionId', 'GetDefQuestion', 'GetDefQuestionInfo'] },
}

const pad2 = (n) => String(n).padStart(2, '0')

function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('gb18030').decode(buffer)
  }
}

function sniffMediaType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'image/png'
}

async function readImageResponse(response) {
  if (!response.ok) throw new Error('答卷图像请求失败：HTTP ' + response.status)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('答卷图像为空')
  if (/^\s*<(?:!doctype|html|head|body)/i.test(buffer.toString('utf8', 0, Math.min(200, buffer.length)))) throw new Error('图像接口返回登录页，请重新登录')
  return { bytes: buffer, mediaType: sniffMediaType(buffer) }
}

// Replicates the original front-end `escape()` used on image paths.
function escapeImagePath(p) {
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    const code = p.charCodeAt(i)
    if (code < 128 && (/[A-Za-z0-9]/.test(ch) || '@*_+-./'.includes(ch))) {
      out += ch
    } else if (code < 256) {
      out += '%' + code.toString(16).toUpperCase().padStart(2, '0')
    } else {
      out += '%u' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

export class ReadonlyClient {
  constructor(base = 'https://example.invalid/AMEQP/') {
    this.base = base.endsWith('/') ? base : base + '/'
    this.cookies = new Map()
    this.prefix = ''
    this.imageHost = '' // pathImageHost 隐藏字段，web 图直读站点
    this.host = ''      // 当前站点主机（不含路径）
    this.productionMarking = false // 正式阅卷开关：允许领卷/提交/取消
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async request(pathname, form) {
    const url = this.base + pathname
    const headers = {}
    const cookie = this.cookieHeader()
    if (cookie) headers['Cookie'] = cookie
    let body
    if (form) {
      body = new URLSearchParams(form).toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    const res = await fetch(url, { method: form ? 'POST' : 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(45000) })
    if (res.status >= 400) throw new Error('阅卷系统请求失败：HTTP ' + res.status)
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const sc of setCookies) {
      const pair = String(sc).split(';')[0]
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    return decode(Buffer.from(await res.arrayBuffer()))
  }

  async page(pathname) {
    return this.request(pathname)
  }

  async login(username, password) {
    await this.page('index.aspx')
    const d = new Date()
    const t = pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds())
    const encrypted = encMe(password, t)
    const raw = await this.request('Login_Handler.ashx?action=logindes', {
      txt_useID: username, txt_usePassword: encrypted, Login_Type: 'tea', t,
    })
    let result
    try { result = JSON.parse(raw) } catch { throw new Error('登录响应无法解析') }
    if (result.State !== 'OK') throw new Error('登录失败：' + String((result.Msg || 'unknown').replace(/<[^>]*>/g, ' ')))
    await this.loadPrefix()
    return result.NextUrl
  }

  async logout() {
    // 复刻原站退出：loginout 接口 + 跳转 Exit.aspx，确保服务端会话彻底关闭，
    // 避免触发「未安全退出」的账号锁定。
    try { await this.request('Login_Handler.ashx?action=loginout', {}) } catch { /* ignore */ }
    try { await this.request('Exit.aspx') } catch { /* ignore */ }
    this.cookies.clear()
  }

  async loadPrefix() {
    const text = await this.page('Webroot/sco/Sco_ImgShow.aspx')
    const pm = /id="pImage"[^>]*value="([^"]+)"/.exec(text)
    this.prefix = pm ? pm[1] : ''
    const hm = /id="pathImageHost"[^>]*value="([^"]+)"/.exec(text)
    this.imageHost = hm ? hm[1] : ''
    try { this.host = new URL(this.base).origin } catch { this.host = '' }
    return this.prefix
  }

  // 判断文件扩展名是否为 web 图（jpg/gif/png/jpeg），原站对这类图直接读站点。
  isWebImage(pathname) {
    const ext = String(pathname || '').split('.').pop().toLowerCase()
    return ['jpg', 'gif', 'png', 'jpeg'].includes(ext)
  }

  async query(pathname, query = {}, fields = {}) {
    const rules = ALLOWED[pathname]
    if (!rules) throw new Error('该接口不在已审查的只读白名单中')
    const params = { ...query }
    for (const [k, v] of Object.entries(fields)) {
      if (k in params && String(params[k]) !== String(v)) throw new Error('参数冲突')
      params[k] = v
    }
    for (const [k, values] of Object.entries(rules)) {
      if (!values.includes(String(params[k]))) throw new Error('该操作不在只读白名单中')
    }
    const qs = new URLSearchParams(query).toString()
    const raw = await this.request(pathname + (qs ? '?' + qs : ''), fields)
    try { return JSON.parse(raw) } catch { throw new Error('系统返回内容无法解析为 JSON') }
  }

  async fetchImageBytes(filePath, area) {
    const cookie = this.cookieHeader()
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    // Show_Image.ashx 需要带 pImage 前缀的绝对路径（相对路径返回空）。
    // 响应 Content-Type 可能误标为 text/html，实际是 GIF/PNG 图像数据，按字节魔数嗅探。
    let p = filePath.includes(':') ? filePath : this.prefix + filePath
    p = p.replace(/\\/g, '/')
    const params = new URLSearchParams({
      pointX: String(Math.min(area.imgAreX1, area.imgAreX2)),
      pointY: String(Math.min(area.imgAreY1, area.imgAreY2)),
      cutW: String(Math.abs(area.imgAreX2 - area.imgAreX1)),
      cutH: String(Math.abs(area.imgAreY2 - area.imgAreY1)),
      bCut: 'true',
    }).toString()
    const url = this.base + 'Webroot/Control/Show_Image.ashx?filePath=' + escapeImagePath(p) + '&' + params
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45000) })
    return readImageResponse(res)
  }

  async answerImages(exam, subject, question, stuSN) {
    const value = await this.query('Webroot/sco_ashx/Sco_StuAnsImgHandler.ashx', {}, {
      type: 'getimgandque', exaSN: exam, exaSubSN: subject, stuSN: stuSN, exaQueSN: question,
    })
    if (value.State !== 'OK') throw new Error('答卷图像读取失败')
    const data = value.Data
    const output = []
    for (const area of data.ds2) {
      const pageRec = data.ds.find((p) => p.imgSN === area.imgSN)
      if (!pageRec) continue
      output.push(await this.fetchImageBytes(pageRec.ansImgPath, area))
    }
    if (!output.length) throw new Error('该答卷未返回评分区域')
    return output
  }

  /**
   * 领卷后取题目分割图：用领卷响应的 AnsImagePageRec（整页图 ansImgPath）
   * + GetDefQuestionInfo 的 ImageArea（裁切坐标）匹配 imgSN，
   * 经 Show_Image.ashx 裁切得到当前题目的分割答卷图。
   * 多区域并行下载。
   */
  async claimCropImages(exam, subject, question, sessionId, claimData) {
    const info = await this.defQuestionInfo(exam, subject, question, sessionId)
    const areas = (info && info.ImageArea) || []
    if (!areas.length) throw new Error('该题目没有配置图像区域')
    const pages = claimData.AnsImagePageRec || []
    if (!pages.length) throw new Error('领卷未返回整页图像')
    const jobs = []
    for (const area of areas) {
      const page = pages.find((p) => String(p.imgSN) === String(area.imgSN))
      if (!page) continue
      const fp = page.ansImgPath || page.FileName
      if (!fp) continue
      jobs.push(this.fetchImageBytes(fp, area))
    }
    const output = await Promise.all(jobs)
    if (output.length !== areas.length) throw new Error('部分答卷区域缺少对应图像，请检查整页答卷')
    if (!output.length) throw new Error('未取到题目分割图')
    return output
  }

  /**
   * 领卷响应的 AnsImageQuestionAreaRec.FileName 取图（已经是切割好的题目区域图）。
   * web 图（jpg/gif/png/jpeg）走 ameqp_webimg 直读；非 web 图走 Show_Image.ashx。
   */
  async fetchByFileName(fileName) {
    const cookie = this.cookieHeader()
    const headers = {}
    if (cookie) headers['Cookie'] = cookie
    let p = String(fileName || '').replace(/\\/g, '/')
    if (!p) throw new Error('答卷图像路径为空')
    if (this.isWebImage(p)) {
      // web 图：去掉 pImage 前缀，走 hostUrl + 相对路径直读
      let rel = p
      const prefixSlash = (this.prefix || '').replace(/\\/g, '/')
      if (prefixSlash && rel.toLowerCase().startsWith(prefixSlash.toLowerCase())) {
        rel = rel.slice(prefixSlash.length).replace(/^\//, '')
      }
      const hostUrl = (this.imageHost || this.host) + '/ameqp_webimg/'
      // 路径含中文，逐段编码（保留 / 分隔符）
      const encodedRel = rel.split('/').map((seg) => encodeURIComponent(seg)).join('/')
      const url = hostUrl + encodedRel
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(45000) })
      return readImageResponse(res)
    }
    // 非 web 图：补 pImage 前缀，走 Show_Image.ashx
    let full = p.includes(':') ? p : this.prefix + p
    full = full.replace(/\\/g, '/')
    const url = this.base + 'Webroot/Control/Show_Image.ashx?filePath=' + escapeImagePath(full)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(45000) })
    return readImageResponse(res)
  }

  /**
   * 只读取图（不领卷）：getStuImgList 拿学生答卷页 + GetDefQuestionInfo 拿题目裁切区域，
   * 组合后经 Show_Image.ashx（带前缀路径 + 裁切参数）取题目区域图。
   * 适用于进行中考试；已完成考试也可用。
   */
  async questionCropImages(exam, subject, question, ansStuSN, sessionId) {
    const imgList = await this.query('Webroot/def_ashx/Def_AnswerHandler.ashx', { type: 'getStuImgList' }, {
      exaSN: exam, exaSubSN: subject, ansStuSN,
    })
    const pages = (imgList.Data && imgList.Data.StuImg) || []
    if (!pages.length) throw new Error('该学生没有答卷页图像')
    const info = await this.defQuestionInfo(exam, subject, question, sessionId)
    const areas = (info && info.ImageArea) || []
    if (!areas.length) throw new Error('该题目没有配置图像区域')
    const output = []
    for (const area of areas) {
      const page = pages.find((p) => p.imgSN === area.imgSN)
      if (!page) continue
      output.push(await this.fetchImageBytes(page.ansImgPath, area))
    }
    if (!output.length) throw new Error('未取到题目区域图像')
    return output
  }

  async listExams() {
    const found = new Map()
    // 1) 优先尝试管理员接口 getPaging（能列出已完成 + 未完成考试，教师账号无权限返回空）
    try {
      for (const finished of ['false', 'true']) {
        const value = await this.query('Webroot/Exa_ashx/Exa_ExamHandler.ashx', {}, { type: 'getPaging', isFinish: finished, page: 1, rows: 100 })
        const batch = Array.isArray(value) ? value : (value.rows || [])
        for (const r of batch) {
          const id = Number(r.exaSN)
          if (!id || id <= 0) continue
          found.set(id, { id, name: r.exaName, date: String((r.exaDate || '')).slice(0, 10), is_finish: !!r.isFinish })
        }
      }
    } catch (e) { /* 无权限则回退 */ }
    // 2) 教师阅卷入口：未完成考试（getPaging 教师无权限时用这个）
    if (found.size === 0) {
      const nofin = await this.query('Webroot/Control/Top_SearchHandler.ashx', { type: 'getExamNoFinish', comboType: 0, pmtCode: 'mar_mark' })
      const arr = Array.isArray(nofin) ? nofin : (nofin.rows || [])
      for (const r of arr) {
        const id = Number(r.exaSN)
        if (!id || id <= 0) continue
        found.set(id, { id, name: r.exaName, date: String((r.exaDate || '')).slice(0, 10), is_finish: false })
      }
    }
    return [...found.values()]
  }

  async listSubjects(exam) {
    // 进行中考试走 mar_mark，已完成考试走 def_answer；两者都试，取有数据者。
    for (const pmtCode of ['mar_mark', 'def_answer']) {
      try {
        const result = await this.query('Webroot/Control/Top_SearchHandler.ashx',
          { type: 'getExamSub', comboType: 0, pmtCode, exaSN: exam })
        const rows = Array.isArray(result) ? result : (result.rows || [])
        const filtered = rows.filter((r) => Number(r.exaSubSN) > 0)
        if (filtered.length) {
          return filtered.map((r) => ({ id: Number(r.exaSubSN), name: r.exaSubName, is_create: !!r.isCreate }))
        }
      } catch (e) { /* 尝试下一个 */ }
    }
    return []
  }

  async listQuestions(exam, subject, isCreate) {
    const result = await this.query('Webroot/Control/Top_SearchHandler.ashx', {
      type: 'getExamQuestion', comboType: 0, exaSN: exam, exaSubSN: subject, isCreate: String(isCreate),
    })
    const rows = Array.isArray(result) ? result : (result.rows || [])
    return rows.filter((r) => Number(r.queSN) > 0).map((r) => ({
      id: Number(r.queSN), name: r.queName || r.queNo, max_score: Number(r.queScore),
    }))
  }

  async listStudents(exam, subject, page, rows) {
    const value = await this.query('Webroot/def_ashx/Def_AnswerHandler.ashx', {}, {
      type: 'getPaging', exaSN: exam, exaSubSN: subject, exaOrganizeRange: 'D',
      stuFilter: '', nodeType: '', nodeValue: '', isHavePaper: 'true', stuKind: '', sKey: '', page, rows,
    })
    return Array.isArray(value) ? value : (value.rows || [])
  }

  async studentMeta(exam, subject, ansStuSN) {
    const value = await this.query('Webroot/def_ashx/Def_AnswerHandler.ashx', { type: 'getStuMsg' }, {
      exaSN: exam, exaSubSN: subject, ansStuSN,
    })
    return value[0]
  }

  /* ---------- 阅卷会话（只读元数据，不领卷/不写分） ---------- */

  async ansOp(op, fields = {}) {
    const raw = await this.request('Webroot/ans_ashx/AnsQuestionHandler.ashx?op=' + encodeURIComponent(op), fields)
    let result
    try { result = JSON.parse(raw) } catch { throw new Error('系统返回内容无法解析为 JSON') }
    return result
  }

  async getSessionId() {
    const value = await this.ansOp('GetSessionId', {})
    if (value.State !== 'OK' || !value.Data || !value.Data.SessionId) throw new Error('阅卷会话初始化失败')
    return value.Data
  }

  // Exact contract from original mar_data_load.js LogUpdateTime: no scoring writes.
  async keepAlive(exam, subject, question, sessionId) {
    const value = await this.ansOp('LogUpdateTime', { SessionId: sessionId, exaSN: exam, exaSubSN: subject, queSN: question })
    if (String(value?.State || '').toUpperCase() === 'ERR') throw new Error(String(value.Msg || '阅卷会话保活失败').replace(/<[^>]*>/g, ' '))
    return value
  }

  async defQuestions(exam, subject, sessionId) {
    const value = await this.ansOp('GetDefQuestion', { exaSN: exam, exaSubSN: subject, SessionId: sessionId })
    if (value.State !== 'OK' || !value.Data) throw new Error('读取题目列表失败')
    const qs = Array.isArray(value.Data.Question) ? value.Data.Question : []
    return qs.filter((q) => Number(q.queSN) > 0).map((q) => ({ id: Number(q.queSN), name: q.queNo || q.queName, que_index: q.queIndex }))
  }

  // 题目定义在一批复阅中是固定的，缓存以减少每次评分的往返。
  async defQuestionInfo(exam, subject, question, sessionId) {
    const key = `${exam}:${subject}:${question}:${sessionId}`
    if (!this._defInfoCache) this._defInfoCache = new Map()
    const hit = this._defInfoCache.get(key)
    if (hit) return hit
    const value = await this.ansOp('GetDefQuestionInfo', { exaSN: exam, exaSubSN: subject, queSN: question, SessionId: sessionId })
    if (value.State !== 'OK' || !value.Data) throw new Error('读取题目定义失败')
    this._defInfoCache.set(key, value.Data)
    return value.Data
  }

  /* ---------- 正式阅卷（领卷/提交/取消，默认关闭，需生产开关授权） ---------- */

  // 写操作白名单：只有 productionMarking 打开时才允许这些 op。
  _assertMarkingAllowed(op) {
    if (!this.productionMarking) throw new Error('正式阅卷未开启，当前仅允许只读查询')
    if (!['GetQuestion', 'SubmitScore', 'GetCancel'].includes(op)) throw new Error('未知阅卷写操作')
  }

  // 领卷（会占卷）。返回完整 Data：ansQueSN/ansStuSN/ansMultiMethod/ansQueMarkState/
  // marIsTryMark/AnsImagePageRec/AnsImageQuestionAreaRec/Point/ansQueMarkValue/AmsMark 等。
  async getQuestion(exam, subject, question, sessionId, isJudge = false) {
    this._assertMarkingAllowed('GetQuestion')
    let value
    try {
      value = await this.ansOp('GetQuestion', { exaSN: exam, exaSubSN: subject, queSN: question, IsJudge: isJudge ? 'true' : 'false', SessionId: sessionId })
    } catch (error) {
      // Once dispatched, a transport/decoding failure does not prove the server
      // failed to allocate a paper. Preserve ambiguity instead of claiming again.
      error.claimUncertain = true
      throw error
    }
    if (value.State !== 'OK') throw new Error((value.Msg || '领卷失败').replace(/<[^>]*>/g, ' '))
    return value.Data
  }

  // 提交评分。ansMar 需完整字段；postilArr 批注数组（可为 []）。
  // oldVal 是原分合计（数值），必须传数字，空串会让服务端数值解析报错。
  async submitScore(exam, subject, question, sessionId, ansMar, postilArr, oldVal, ansMultiMethod) {
    this._assertMarkingAllowed('SubmitScore')
    const mar = JSON.stringify(ansMar)
    const postilDomList = JSON.stringify(postilArr || [])
    const oldValNum = Number(oldVal)
    const value = await this.ansOp('SubmitScore', {
      exaSN: exam, exaSubSN: subject, queSN: question,
      mar, postilDomList,
      oldVal: Number.isFinite(oldValNum) ? oldValNum : 0,
      ansMultiMethod: String(ansMultiMethod || 'A'),
      SessionId: sessionId,
    })
    if (value.State !== 'OK') throw new Error((value.Msg || '提交失败').replace(/<[^>]*>/g, ' '))
    return value.Data
  }

  // 取消当前领卷，恢复未分发状态。
  async cancelQuestion(exam, subject, question, sessionId, ansQueSN, ansQueMarkState, isReview, ansMultiMethod) {
    this._assertMarkingAllowed('GetCancel')
    const value = await this.ansOp('GetCancel', {
      exaSN: exam, exaSubSN: subject, queSN: question,
      ansQueSN, ansQueMarkState, IsReview: isReview ? 'true' : 'false', 'ansMultiMethod ': String(ansMultiMethod || ''), SessionId: sessionId,
    })
    if (value.State !== 'OK') throw new Error((value.Msg || '取消领卷未成功，请在原系统核对').replace(/<[^>]*>/g, ' '))
    return value
  }
}
