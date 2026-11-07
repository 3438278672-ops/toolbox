import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { repair } from '../lib/repair.mjs'
import { makePlugin, writeFiles, GBK_CN_TEST, utf16leBom, readBuffer } from './helpers.mjs'

async function cleanup(t, root) {
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
}

test('dry-run reports fixable files without writing or backing up', async (t) => {
  const root = await makePlugin('enc-dry-', {
    'docs/gbk.txt': GBK_CN_TEST,
    'utf16.txt': utf16leBom('中文'),
  })
  await cleanup(t, root)
  const before = await readBuffer(path.join(root, 'docs/gbk.txt'))

  const report = await repair({ dirs: [root] })
  assert.equal(report.verdict, 'fixable')
  assert.equal(report.counts.fixable, 2)
  assert.equal(report.counts.fixed, 0)
  assert.equal(report.fix, false)
  assert.deepEqual(await readBuffer(path.join(root, 'docs/gbk.txt')), before)
  await assert.rejects(fsp.access(path.join(root, 'docs/gbk.txt.bak')))
})

test('fix converts GBK and UTF-16, backs up originals, and is idempotent', async (t) => {
  const root = await makePlugin('enc-fix-', {
    'docs/gbk.txt': GBK_CN_TEST,
    'utf16.txt': utf16leBom('中文'),
    'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello', 'utf8')]),
  })
  await cleanup(t, root)

  const first = await repair({ dirs: [root], fix: true })
  assert.equal(first.verdict, 'fixed')
  assert.equal(first.counts.fixed, 3)
  assert.equal(first.counts.errors, 0)

  assert.equal(await fsp.readFile(path.join(root, 'docs/gbk.txt'), 'utf8'), '中文测试')
  assert.equal(await fsp.readFile(path.join(root, 'utf16.txt'), 'utf8'), '中文')
  assert.equal(await fsp.readFile(path.join(root, 'bom.txt'), 'utf8'), 'hello')
  assert.deepEqual(await readBuffer(path.join(root, 'docs/gbk.txt.bak')), GBK_CN_TEST)
  assert.equal((await fsp.readdir(path.join(root, 'docs'))).some((name) => name.endsWith('.tmp')), false)

  const second = await repair({ dirs: [root], fix: true })
  assert.equal(second.counts.fixed, 0)
  assert.equal(second.verdict, 'clean')
})

test('an existing .bak gets a numbered sibling', async (t) => {
  const root = await makePlugin('enc-bak-', { 'docs/gbk.txt': GBK_CN_TEST })
  await cleanup(t, root)
  await writeFiles(root, { 'docs/gbk.txt.bak': 'older backup' })

  await repair({ dirs: [root], fix: true })
  assert.equal(await fsp.readFile(path.join(root, 'docs/gbk.txt.bak'), 'utf8'), 'older backup')
  assert.deepEqual(await readBuffer(path.join(root, 'docs/gbk.txt.bak.1')), GBK_CN_TEST)
})

test('binary files are skipped and ignored files are not touched', async (t) => {
  const root = await makePlugin('enc-skip-', {
    'blob.bin': Buffer.from([0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9]),
    'ignored.txt': GBK_CN_TEST,
  })
  await cleanup(t, root)

  const report = await repair({ dirs: [root], fix: true })
  assert.equal(report.counts.binary, 1)
  assert.equal(report.counts.fixed, 0)
  assert.deepEqual(await readBuffer(path.join(root, 'ignored.txt')), GBK_CN_TEST)
  await assert.rejects(fsp.access(path.join(root, 'ignored.txt.bak')))
})

test('mojibake is reported but never rewritten', async (t) => {
  const root = await makePlugin('enc-moji-', {
    'moji.txt': Buffer.from('中文 \uFFFD 结尾', 'utf8'),
  })
  await cleanup(t, root)
  const before = await readBuffer(path.join(root, 'moji.txt'))

  const report = await repair({ dirs: [root], fix: true })
  assert.equal(report.counts.fixed, 0)
  assert.equal(report.counts.reported, 1)
  assert.deepEqual(await readBuffer(path.join(root, 'moji.txt')), before)
  await assert.rejects(fsp.access(path.join(root, 'moji.txt.bak')))
})

test('existing .bak files are not scanned as sources', async (t) => {
  const root = await makePlugin('enc-bakscan-', {
    'gbk.txt': GBK_CN_TEST,
    'gbk.txt.bak': GBK_CN_TEST,
  })
  await cleanup(t, root)

  const report = await repair({ dirs: [root] })
  assert.equal(report.packages[0].skipped.backups, 1)
  assert.equal(report.counts.fixable, 1)
})

test('multiple package dirs are reported together', async (t) => {
  const one = await makePlugin('enc-one-', { 'gbk.txt': GBK_CN_TEST })
  const two = await makePlugin('enc-two-', { 'utf16.txt': utf16leBom('中文') })
  await cleanup(t, one)
  await cleanup(t, two)

  const report = await repair({ dirs: [one, two] })
  assert.equal(report.packages.length, 2)
  assert.equal(report.counts.fixable, 2)
})
