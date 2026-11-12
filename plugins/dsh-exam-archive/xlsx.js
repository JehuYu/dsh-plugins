/**
 * 极简 xlsx 读取器（零依赖）。
 *
 * .xlsx 本质是 ZIP 包：读中央目录 → 解压 `xl/sharedStrings.xml` 与各工作表 XML →
 * 用正则把 `<row>/<c r="A1" t="s"><v>0</v></c>` 还原成二维字符串数组。
 * 支持多张工作表（组长表每个年级一个 sheet）。
 */
import { inflateRawSync } from 'node:zlib'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

const MAX_INPUT = 32 * 1024 * 1024
const MAX_ENTRY = 16 * 1024 * 1024
const MAX_TOTAL = 64 * 1024 * 1024
const MAX_ROWS = 100000
const MAX_COLS = 1024
const MAX_CELLS = 500000

const EOCD = 0x06054b50
const CEN = 0x02014b50

/** 读 ZIP 中央目录，得到 name → {method, compSize, localOff}。 */
function readCentralDirectory(buf, name) {
  if (buf.length > MAX_INPUT) throw new Error('xlsx 文件超过 32 MiB 限制')
  let eocd = -1
  const floor = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`${name} 不是有效的 xlsx（未找到 ZIP 目录）`)

  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  if (count > 4096 || off >= eocd) throw new Error('ZIP 目录无效或条目过多')
  const entries = new Map()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (off + 46 > eocd || buf.readUInt32LE(off) !== CEN) throw new Error('ZIP 目录截断')
    const method = buf.readUInt16LE(off + 10)
    const flags = buf.readUInt16LE(off + 8)
    const size = buf.readUInt32LE(off + 24)
    total += size
    if ((flags & 1) || size > MAX_ENTRY || total > MAX_TOTAL) throw new Error('ZIP 加密或展开大小超过限制')
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    if (off + 46 + nameLen + extraLen + commentLen > eocd) throw new Error('ZIP 条目截断')
    const entryName = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (entries.has(entryName)) throw new Error('ZIP 重复条目')
    entries.set(entryName, { method, compSize, localOff, size })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 取出一个条目的明文字节；不存在的条目返回 null。 */
function readEntry(buf, entries, entryName) {
  const e = entries.get(entryName)
  if (!e) return null
  const lo = e.localOff
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('ZIP 本地头无效')
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  if (start + e.compSize > buf.length) throw new Error('ZIP 内容截断')
  const raw = buf.subarray(start, start + e.compSize)
  let out
  if (e.method === 0) out = raw
  else if (e.method === 8) out = inflateRawSync(raw, { maxOutputLength: Math.min(MAX_ENTRY, e.size + 1) })
  if (out) {
    if (out.length !== e.size) throw new Error('ZIP 展开大小不匹配')
    return out
  }
  throw new Error(`不支持的压缩方式 ${e.method}`)
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

/** 单元格引用 A1 / AB12 → {col, row}（col 从 0 起）。 */
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || '')
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  if (col > MAX_COLS || Number(m[2]) > MAX_ROWS || Number(m[2]) < 1) throw new Error('xlsx 单元格坐标超过限制')
  return { col: col - 1, row: Number(m[2]) - 1 }
}

/** 解析共享字符串表：每个 <si> 里的所有 <t> 拼接（富文本会分片）。 */
function parseSharedStrings(xml) {
  const out = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let t
    let text = ''
    while ((t = tRe.exec(m[1])) !== null) text += decodeXml(t[1])
    if (out.length >= MAX_CELLS) throw new Error('xlsx 共享字符串过多')
    out.push(text)
  }
  return out
}

/** 解析单张工作表 XML 为稀疏二维数组。 */
function parseSheet(xml, shared) {
  const rows = []
  let cellCount = 0
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowOpen = /<row\b([^>]*)>/.exec(rm[0])
    const rowIdx = rowOpen ? Number((/r="(\d+)"/.exec(rowOpen[1]) || [])[1]) - 1 : rows.length
    if (!Number.isInteger(rowIdx) || rowIdx < 0 || rowIdx >= MAX_ROWS) throw new Error('xlsx 行号无效或超过限制')
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[1])) !== null) {
      if (++cellCount > MAX_CELLS) throw new Error('xlsx 单元格过多')
      const attrs = cm[1]
      const body = cm[2] || ''
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]
      const pos = splitRef(ref)
      const col = pos ? pos.col : cells.length
      if (col >= MAX_COLS) throw new Error('xlsx 列数超过限制')
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1]

      let value = ''
      if (type === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
        let t
        while ((t = tRe.exec(body)) !== null) value += decodeXml(t[1])
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        if (v) {
          const raw = decodeXml(v[1])
          value = type === 's' ? shared[Number(raw)] ?? '' : raw
        }
      }
      cells[col] = String(value ?? '').trim()
    }
    rows[rowIdx >= 0 ? rowIdx : rows.length] = cells
  }
  return rows
}

/** 取所有工作表：名字 → 二维数组。 */
function allSheets(buf, entries) {
  const sheets = []
  const wb = readEntry(buf, entries, 'xl/workbook.xml')
  if (wb) {
    const xml = wb.toString('utf8')
    const relsXml = readEntry(buf, entries, 'xl/_rels/workbook.xml.rels')
    const rels = relsXml ? relsXml.toString('utf8') : ''
    const sheetRe = /<sheet\b([^>]*)\/?>/g
    let sm
    let idx = 0
    while ((sm = sheetRe.exec(xml)) !== null) {
      const name = (/name="([^"]*)"/.exec(sm[1]) || [])[1]
      const relId = (/r:id="([^"]+)"/.exec(sm[1]) || [])[1]
      let path = null
      if (relId && rels) {
        const escapedId = relId.replace(/[.*+?^${}()|[\]\\]/g, ch => '\\' + ch)
        const re = new RegExp(`<Relationship\\b([^>]*Id="${escapedId}"[^>]*)/>`)
        const hit = re.exec(rels)
        const target = hit ? (/Target="([^"]+)"/.exec(hit[1]) || [])[1] : null
        if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
      sheets.push({ name: name ? decodeXml(name) : null, path: path || `xl/worksheets/sheet${idx + 1}.xml` })
      idx += 1
    }
  }
  return sheets
}

/**
 * 读取一个 .xlsx 的全部工作表。
 * @returns {{ sheets: Array<{ name: string|null, rows: string[][] }> }}
 */
function parseXlsxAllSheets(buf, fileName = 'xlsx') {
  const entries = readCentralDirectory(buf, fileName)
  const sharedBuf = readEntry(buf, entries, 'xl/sharedStrings.xml')
  const shared = sharedBuf ? parseSharedStrings(sharedBuf.toString('utf8')) : []
  const list = allSheets(buf, entries)
  const sheets = list.map((s) => {
    const sheetBuf = readEntry(buf, entries, s.path)
    if (!sheetBuf) return { name: s.name, rows: [] }
    return { name: s.name, rows: parseSheet(sheetBuf.toString('utf8'), shared) }
  })
  return { sheets }
}

// Parsing, inflation and sparse-array construction never run on the Host thread.
export function readXlsxAllSheets(buf, fileName = 'xlsx') {
  if (buf.length > MAX_INPUT) return Promise.reject(new Error('xlsx 文件超过 32 MiB 限制'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { examArchiveXlsx: true, buf, fileName },
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => {})
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('xlsx 解析超时')), 15000)
    worker.once('message', result => result.error ? finish(new Error(result.error)) : finish(null, result.value))
    worker.once('error', error => finish(error))
    worker.once('exit', code => { if (!settled) finish(new Error('xlsx worker 提前退出: ' + code)) })
  })
}

if (!isMainThread && workerData?.examArchiveXlsx) {
  try { parentPort.postMessage({ value: parseXlsxAllSheets(Buffer.from(workerData.buf), workerData.fileName) }) }
  catch (error) { parentPort.postMessage({ error: String(error.message || error) }) }
}
