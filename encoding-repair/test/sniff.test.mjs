import test from 'node:test'
import assert from 'node:assert/strict'
import { sniff } from '../lib/sniff.mjs'
import { GBK_CN_TEST, BIG5_CN_TEST, utf16leBom, utf16beBom, utf32leBom } from './helpers.mjs'

test('clean UTF-8 is left alone', () => {
  const result = sniff(Buffer.from('中文 hello\n', 'utf8'))
  assert.equal(result.encoding, 'utf8')
  assert.equal(result.fixable, false)
  assert.equal(result.mojibake, false)
})

test('UTF-8 BOM is fixable and stripped', () => {
  const result = sniff(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文', 'utf8')]))
  assert.equal(result.encoding, 'utf8-bom')
  assert.equal(result.fixable, true)
  assert.equal(result.text, '中文')
})

test('UTF-16LE with BOM is decoded', () => {
  const result = sniff(utf16leBom('中文A'))
  assert.equal(result.encoding, 'utf16le')
  assert.equal(result.fixable, true)
  assert.equal(result.text, '中文A')
})

test('UTF-16BE with BOM is decoded', () => {
  const result = sniff(utf16beBom('中文A'))
  assert.equal(result.encoding, 'utf16be')
  assert.equal(result.fixable, true)
  assert.equal(result.text, '中文A')
})

test('UTF-32LE with BOM is decoded', () => {
  const result = sniff(utf32leBom('中文A'))
  assert.equal(result.encoding, 'utf32le')
  assert.equal(result.fixable, true)
  assert.equal(result.text, '中文A')
})

test('GBK is decoded and fixable', () => {
  const result = sniff(GBK_CN_TEST)
  assert.equal(result.encoding, 'gbk')
  assert.equal(result.fixable, true)
  assert.equal(result.text, '中文测试')
})

test('Big5 is reported but not fixable', () => {
  const result = sniff(BIG5_CN_TEST)
  assert.equal(result.fixable, false)
  assert.ok(result.encoding === 'big5' || result.encoding === 'ambiguous')
})

test('UTF-16LE without BOM is detected from zero parity', () => {
  const result = sniff(Buffer.from('hello world', 'utf16le'))
  assert.equal(result.encoding, 'utf16le')
  assert.equal(result.fixable, true)
  assert.equal(result.text, 'hello world')
})

test('binary is skipped', () => {
  const result = sniff(Buffer.from([0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9]))
  assert.equal(result.encoding, 'binary')
  assert.equal(result.fixable, false)
})

test('UTF-8 with replacement characters is report-only mojibake', () => {
  const result = sniff(Buffer.from('中文 \uFFFD 结尾', 'utf8'))
  assert.equal(result.encoding, 'utf8')
  assert.equal(result.mojibake, true)
  assert.equal(result.fixable, false)
})
