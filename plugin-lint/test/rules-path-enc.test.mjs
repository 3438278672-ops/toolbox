import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree, pluginFiles, winPath } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir, { syntaxCheck: false })
}

function of(report, id) {
  return report.findings.filter((finding) => finding.rule === id)
}

test('PAT001 reports a runtime absolute path as error', async (t) => {
  const drivePath = winPath('Users', 'me', 'data')
  const report = await run(t, pluginFiles({ extra: { 'index.js': `const p = '${drivePath}'\n` } }))
  const found = of(report, 'PAT001')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
  assert.equal(found[0].line, 1)
})

test('PAT001 downgrades to warn in test files and info in docs', async (t) => {
  const homePath = ['', 'home', 'alice', 'project'].join('/')
  const optPath = ['', 'opt', 'app', 'config.json'].join('/')
  const report = await run(
    t,
    pluginFiles({
      extra: {
        'test/a.test.mjs': `const p = '${homePath}'\n`,
        'README.md': `# demo\n${optPath}\n`,
      },
    }),
  )
  const pats = of(report, 'PAT001')
  assert.equal(pats.length, 2)
  assert.equal(pats.find((finding) => finding.file === 'test/a.test.mjs').severity, 'warn')
  assert.equal(pats.find((finding) => finding.file === 'README.md').severity, 'info')
})

test('PAT001 downgrades placeholder paths to info', async (t) => {
  const placeholderPath = 'D:' + '\\\\path\\\\to\\\\plugin'
  const report = await run(t, pluginFiles({ extra: { 'index.js': `const p = '${placeholderPath}'\n` } }))
  const found = of(report, 'PAT001')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'info')
  assert.match(found[0].message, /示例路径/)
})

test('PAT001 ignores absolute-looking text inside URLs', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'index.js': "const u = 'https://example.com/home/x'\n" } }))
  assert.equal(of(report, 'PAT001').length, 0)
})

test('ENC001 reports bytes that are not valid UTF-8', async (t) => {
  const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
  const report = await run(t, pluginFiles({ extra: { 'index.js': gbk } }))
  const found = of(report, 'ENC001')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
})

test('ENC002 warns about a UTF-8 BOM', async (t) => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello\n')])
  const report = await run(t, pluginFiles({ extra: { 'index.js': bom } }))
  assert.equal(of(report, 'ENC002').length, 1)
})

test('ENC003 rejects a UTF-16 BOM', async (t) => {
  const utf16 = Buffer.from([0xff, 0xfe, 0x41, 0x00])
  const report = await run(t, pluginFiles({ extra: { 'index.js': utf16 } }))
  const found = of(report, 'ENC003')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
  assert.equal(of(report, 'ENC001').length, 0)
})

test('ENC004 warns about mojibake markers', async (t) => {
  const mojibake = '\u951F\u65A4\u62F7'
  const report = await run(t, pluginFiles({ extra: { 'index.js': `// ${mojibake}\n` } }))
  assert.equal(of(report, 'ENC004').length, 1)
})

test('ENC005 warns about a shebang file with CRLF', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'index.js': '#!/usr/bin/env node\r\nconsole.log(1)\r\n' } }))
  assert.equal(of(report, 'ENC005').length, 1)
})
