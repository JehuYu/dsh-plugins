import test from 'node:test'
import assert from 'node:assert/strict'
import { encMe } from '../login-cipher.js'

// Frozen outputs from the legacy implementation on synthetic inputs only.
// The timestamp-like parameter is a public fixture, never an account credential.
const vectors = [
  ['', ''],
  ['demo', '94e5f085ff73c96d'],
  ['示例', '206371b1321f3dc8'],
  ['demo示例😀', '94e5f085ff73c96d1f65c60211f21de2'],
  ['x'.repeat(9), 'f9e0b04d22cc14b3f9e0b04d22cc14b300b48556f72de977'],
]
for (const [index, [text, expected]] of vectors.entries()) {
  test(`login wire compatibility synthetic vector ${index}`, () => {
    assert.equal(encMe(text, '01020304'), expected)
  })
}
test('login encryption rejects non-ASCII key parameters', () => {
  assert.throws(() => encMe('demo', '示例'), /ASCII/)
})
