/**
 * 极简 xlsx 读取器（零依赖）。
 *
 * .xlsx 本质是 ZIP 包：读中央目录 → 解压 `xl/sharedStrings.xml` 与工作表 XML →
 * 用正则把 `<row>/<c r="A1" t="s"><v>0</v></c>` 还原成二维字符串数组。
 * 只覆盖本插件要读的「进度表」形态，够用且不引入第三方依赖。
 */
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CEN = 0x02014b50

/** 读 ZIP 中央目录，得到 name → {method, compSize, localOff}。 */
function readCentralDirectory(buf, name) {
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
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const entryName = buf.toString('utf8', off + 46, off + 46 + nameLen)
    entries.set(entryName, { method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 取出一个条目的明文字节；不存在的条目返回 null。 */
function readEntry(buf, entries, entryName) {
  const e = entries.get(entryName)
  if (!e) return null
  const lo = e.localOff
  if (lo + 30 > buf.length) return null
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + e.compSize)
  if (e.method === 0) return raw
  if (e.method === 8) return inflateRawSync(raw)
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
    out.push(text)
  }
  return out
}

/** 解析单张工作表 XML 为稀疏二维数组。 */
function parseSheet(xml, shared) {
  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowOpen = /<row\b([^>]*)>/.exec(rm[0])
    const rowIdx = rowOpen ? Number((/r="(\d+)"/.exec(rowOpen[1]) || [])[1]) - 1 : rows.length
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const attrs = cm[1]
      const body = cm[2] || ''
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]
      const pos = splitRef(ref)
      const col = pos ? pos.col : cells.length
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

/** 取第一张工作表的名字与路径（经 workbook.xml + rels 解析，找不到就退回 sheet1.xml）。 */
function firstSheetPath(buf, entries) {
  const wb = readEntry(buf, entries, 'xl/workbook.xml')
  if (wb) {
    const xml = wb.toString('utf8')
    const sheet = /<sheet\b([^>]*)\/?>/.exec(xml)
    const relId = sheet ? (/r:id="([^"]+)"/.exec(sheet[1]) || [])[1] : null
    const name = sheet ? (/name="([^"]*)"/.exec(sheet[1]) || [])[1] : null
    const rels = readEntry(buf, entries, 'xl/_rels/workbook.xml.rels')
    if (relId && rels) {
      const relXml = rels.toString('utf8')
      const re = new RegExp(`<Relationship\\b([^>]*Id="${relId}"[^>]*)/>`)
      const hit = re.exec(relXml)
      const target = hit ? (/Target="([^"]+)"/.exec(hit[1]) || [])[1] : null
      if (target) {
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
        return { path, name: name ? decodeXml(name) : null }
      }
    }
    if (name) return { path: 'xl/worksheets/sheet1.xml', name: decodeXml(name) }
  }
  return { path: 'xl/worksheets/sheet1.xml', name: null }
}

/**
 * 读取一个 .xlsx 的第一张工作表。
 * @returns {{ sheetName: string|null, rows: string[][] }}
 */
export function readXlsxFirstSheet(buf, fileName = 'xlsx') {
  const entries = readCentralDirectory(buf, fileName)
  const sharedBuf = readEntry(buf, entries, 'xl/sharedStrings.xml')
  const shared = sharedBuf ? parseSharedStrings(sharedBuf.toString('utf8')) : []
  const { path, name } = firstSheetPath(buf, entries)
  const sheetBuf = readEntry(buf, entries, path)
  if (!sheetBuf) throw new Error(`${fileName} 里找不到工作表`)
  const rows = parseSheet(sheetBuf.toString('utf8'), shared)
  return { sheetName: name, rows }
}
