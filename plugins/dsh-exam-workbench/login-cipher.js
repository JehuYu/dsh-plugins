import { createCipheriv } from 'node:crypto'

/**
 * AMEQP login wire encoding: UTF-16 code units in big-endian order,
 * zero-padded to an eight-byte block, encrypted in ECB mode, lowercase hex.
 * The login uses an eight-character ASCII timestamp key. Repeating that key
 * three times in EDE3 is equivalent to single DES without a copied JS cipher.
 * For legacy ASCII keys of at least 24 characters, use the first 24 bytes.
 */
export function encMe(text, key) {
  text = String(text)
  key = String(key)
  if (/[^\x00-\x7f]/.test(key)) throw new Error('AMEQP 登录协议需要 ASCII 加密参数')
  const keyBytes = Buffer.alloc(24)
  if (key.length >= 24) {
    keyBytes.write(key.slice(0, 24), 0, 'ascii')
  } else {
    const single = Buffer.alloc(8)
    single.write(key.slice(0, 8), 0, 'ascii')
    single.copy(keyBytes, 0); single.copy(keyBytes, 8); single.copy(keyBytes, 16)
  }
  const input = Buffer.alloc(Math.ceil(text.length / 4) * 8)
  for (let i = 0; i < text.length; i++) input.writeUInt16BE(text.charCodeAt(i), i * 2)
  const cipher = createCipheriv('des-ede3', keyBytes, null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(input), cipher.final()]).toString('hex')
}
