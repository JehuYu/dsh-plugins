/**
 * 依赖零三方库的两个小工具：
 *  - 读 ZIP 中央目录并按需解压条目（用于成绩平台导出的 .zip 成绩包）；
 *  - 写出一个最小可用的 .xlsx（用于生成教学班映射表给 Python 端读取）。
 *
 * 只处理插件自己的输入，所有尺寸都设有上限，不做通用归档解析。
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const MAX_ENTRIES = 4096
const MAX_ENTRY_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_BYTES = 128 * 1024 * 1024

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

function decodeName(buffer, utf8Flag) {
  if (utf8Flag) return buffer.toString('utf8')
  // 很多国产成绩平台用 GBK 存文件名，这里用 Node 自带的解码器回退。
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return buffer.toString('latin1')
  }
}

/**
 * 读取 ZIP 的中央目录。
 * @returns {Promise<Array<{ name: string, read: () => Promise<Buffer> }>>}
 */
export async function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('压缩包内容为空或已损坏。')
  if (buffer.length > MAX_TOTAL_BYTES) throw new Error('压缩包超过 128MB 限制。')

  let eocd = -1
  const floor = Math.max(0, buffer.length - 66000)
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的压缩包（未找到 ZIP 目录）。')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (count > MAX_ENTRIES) throw new Error('压缩包条目过多。')
  if (offset >= eocd) throw new Error('压缩包目录无效。')

  const entries = []
  let declaredTotal = 0

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== CEN_SIG) throw new Error('压缩包目录被截断。')
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const compSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    if (offset + 46 + nameLen + extraLen + commentLen > eocd) throw new Error('压缩包条目被截断。')
    if (flags & 1) throw new Error('压缩包已加密，无法读取。')
    if (compSize > MAX_ENTRY_BYTES || size > MAX_ENTRY_BYTES) throw new Error('压缩包内单个文件超过 32MB 限制。')

    declaredTotal += size
    if (declaredTotal > MAX_TOTAL_BYTES) throw new Error('压缩包展开后超过 128MB 限制。')

    const name = decodeName(buffer.subarray(offset + 46, offset + 46 + nameLen), (flags & 0x800) !== 0)
    const isDir = name.endsWith('/')
    const entry = { name, method, compSize, size, localOffset, isDir }
    offset += 46 + nameLen + extraLen + commentLen

    if (isDir) continue
    entries.push({
      name,
      get size() {
        return entry.size
      },
      async read() {
        return readEntry(buffer, entry)
      },
    })
  }

  return entries
}

function readEntry(buffer, entry) {
  const { localOffset, compSize, method, size } = entry
  if (localOffset + 30 > buffer.length) throw new Error('压缩包本地头无效。')
  if (buffer.readUInt32LE(localOffset) !== LOC_SIG) throw new Error('压缩包本地头签名不正确。')
  const nameLen = buffer.readUInt16LE(localOffset + 26)
  const extraLen = buffer.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLen + extraLen
  if (start + compSize > buffer.length) throw new Error('压缩包内容被截断。')

  const raw = buffer.subarray(start, start + compSize)
  if (method === 0) return Buffer.from(raw)
  if (method !== 8) throw new Error(`不支持的压缩方式：${method}。`)
  const inflated = inflateRawSync(raw, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, size + 1) })
  if (inflated.length !== size) throw new Error('压缩包展开大小不匹配。')
  return inflated
}

/* ------------------------------------------------------------- 写 .xlsx */

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

function columnName(index) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function buildSheetXml(rows) {
  const lines = rows.map((row, rowIndex) => {
    const cells = row
      .map((value, colIndex) => {
        const ref = `${columnName(colIndex)}${rowIndex + 1}`
        if (value === null || value === undefined || value === '') return ''
        if (typeof value === 'number' && Number.isFinite(value)) {
          return `<c r="${ref}"><v>${value}</v></c>`
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
      })
      .join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  })
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${lines.join('')}</sheetData>` +
    '</worksheet>'
  )
}

function zipBuffer(files) {
  const chunks = []
  const central = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const dataBuf = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const compressed = deflateRawSync(dataBuf, { level: 6 })
    const crc = crc32(dataBuf) >>> 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOC_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(dataBuf.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, compressed)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(CEN_SIG, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(8, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0x21, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(compressed.length, 20)
    cen.writeUInt32LE(dataBuf.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(offset, 42)

    central.push(cen, nameBuf)
    offset += local.length + nameBuf.length + compressed.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuf, end])
}

/**
 * 写一份单工作表的 .xlsx。
 * @param {string} filePath 目标路径
 * @param {Array<Array<string|number|null>>} rows 行数据（首行通常是表头）
 * @param {string} sheetName 工作表名
 */
export async function writeXlsxRows(filePath, rows, sheetName = 'Sheet1') {
  const safeSheet = escapeXml(sheetName).slice(0, 31) || 'Sheet1'
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheetXml(rows) },
  ]

  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, zipBuffer(files))
}
