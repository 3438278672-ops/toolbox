import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree, pluginFiles, without } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir)
}

function of(report, id) {
  return report.findings.filter((finding) => finding.rule === id)
}

test('SEC001 blocks a credential file in the published set', async (t) => {
  const report = await run(
    t,
    pluginFiles({ extra: { 'credential.json': '{"token":"x"}\n' } }),
  )
  assert.equal(of(report, 'SEC001').length, 1)
  assert.equal(of(report, 'SEC001')[0].severity, 'error')
  assert.equal(of(report, 'SEC001')[0].snippet, '（内容已省略）')
})

test('SEC001 ignores an example credential file and SEC003 reports it as info', async (t) => {
  const report = await run(
    t,
    pluginFiles({ extra: { 'credential.example.json': '{"token":"<fake>"}\n' } }),
  )
  assert.equal(of(report, 'SEC001').length, 0)
  assert.equal(of(report, 'SEC003').length, 1)
  assert.equal(of(report, 'SEC003')[0].severity, 'info')
})

test('SEC003 reports an ignored credential file as info', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: {
        '.gitignore': 'node_modules/\ncredential.json\n',
        'credential.json': '{"token":"x"}\n',
      },
    }),
  )
  assert.equal(of(report, 'SEC001').length, 0)
  assert.equal(of(report, 'SEC003').length, 1)
})

test('SEC002 catches a runtime key and masks it', async (t) => {
  const key = `sk-${'a'.repeat(32)}`
  const report = await run(t, pluginFiles({ extra: { 'index.js': `const key = '${key}'\n` } }))
  const found = of(report, 'SEC002')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
  assert.match(found[0].message, /sk-a…/)
  assert.ok(!found[0].message.includes(key.slice(4)))
})

test('SEC002 downgrades a placeholder value to info', async (t) => {
  const report = await run(
    t,
    pluginFiles({ extra: { 'index.js': "const key = 'sk-your-key-1234567890'\n" } }),
  )
  const found = of(report, 'SEC002')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'info')
  assert.match(found[0].message, /占位符/)
})

test('SEC002 catches a plaintext password at runtime severity', async (t) => {
  const report = await run(
    t,
    pluginFiles({ extra: { 'index.js': "const password = 'SuperSecret123'\n" } }),
  )
  const found = of(report, 'SEC002')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
  assert.match(found[0].message, /密码/)
})

test('SEC002 reports a private key block without printing it', async (t) => {
  const report = await run(
    t,
    pluginFiles({ extra: { 'index.js': '-----BEGIN RSA PRIVATE KEY-----\nbody\n' } }),
  )
  const found = of(report, 'SEC002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /私钥块/)
  assert.ok(!found[0].snippet.includes('body'))
})

test('REPO001 warns when .gitignore is missing', async (t) => {
  const report = await run(t, without(pluginFiles(), '.gitignore'))
  assert.equal(of(report, 'REPO001').length, 1)
  assert.equal(of(report, 'REPO001')[0].severity, 'warn')
})

test('REPO002 blocks an unignored node_modules', async (t) => {
  const files = without(pluginFiles(), '.gitignore')
  files['node_modules/foo/package.json'] = '{"name":"foo"}\n'
  files['node_modules/foo/index.js'] = 'module.exports = 1\n'
  const report = await run(t, files)
  assert.equal(of(report, 'REPO002').length, 1)
  assert.equal(of(report, 'REPO002')[0].severity, 'error')
})

test('REPO003 warns about a file over the warn threshold', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: {
        '.pluginlint.json': JSON.stringify({
          limits: { largeFileWarnBytes: 1000, largeFileErrorBytes: 2000 },
        }),
        'big.txt': 'x'.repeat(1500),
      },
    }),
  )
  assert.equal(of(report, 'REPO003').length, 1)
  assert.equal(of(report, 'REPO004').length, 0)
})

test('REPO004 blocks a file over the error threshold', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: {
        '.pluginlint.json': JSON.stringify({
          limits: { largeFileWarnBytes: 1000, largeFileErrorBytes: 2000 },
        }),
        'huge.txt': 'x'.repeat(2500),
      },
    }),
  )
  assert.equal(of(report, 'REPO004').length, 1)
  assert.equal(of(report, 'REPO003').length, 0)
})

test('REPO005 reports an unignored cache directory', async (t) => {
  const report = await run(t, pluginFiles({ extra: { '.venv/lib/x.txt': 'x\n' } }))
  assert.equal(of(report, 'REPO005').length, 1)
  assert.equal(of(report, 'REPO005')[0].severity, 'info')
})
