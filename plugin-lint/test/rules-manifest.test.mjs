import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree, pluginFiles } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir)
}

function rules(report) {
  return report.findings.map((finding) => finding.rule)
}

test('a complete plugin manifest has no findings', async (t) => {
  const report = await run(t, pluginFiles())
  assert.deepEqual(rules(report), [])
  assert.equal(report.verdict, 'publishable')
})

test('PKG001 blocks when package.json is missing', async (t) => {
  const files = pluginFiles()
  delete files['package.json']
  const report = await run(t, files)
  assert.ok(rules(report).includes('PKG001'))
  assert.equal(report.verdict, 'blocked')
})

test('PKG002 rejects an invalid package name', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { name: 'Bad Name' } }))
  assert.ok(rules(report).includes('PKG002'))
})

test('PKG003 rejects a non-semver version', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { version: '1.0' } }))
  assert.ok(rules(report).includes('PKG003'))
})

test('PKG004 and PKG005 warn about missing description and license', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { description: undefined, license: undefined } }))
  assert.ok(rules(report).includes('PKG004'))
  assert.ok(rules(report).includes('PKG005'))
  assert.equal(report.verdict, 'publishable')
})

test('PKG006 warns when there is neither exports nor main', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { exports: undefined, main: undefined } }))
  assert.ok(rules(report).includes('PKG006'))
})

test('PKG007 catches an export target that was not published', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { exports: { '.': './missing.js' } } }))
  assert.ok(rules(report).includes('PKG007'))
  assert.equal(report.verdict, 'blocked')
})

test('PKG008 warns without a files whitelist', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { files: undefined } }))
  assert.ok(rules(report).includes('PKG008'))
})

test('PKG009 catches a files entry with no matching file', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { files: ['index.js', 'nope.js'] } }))
  const found = report.findings.filter((finding) => finding.rule === 'PKG009')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /nope\.js/)
})

test('PKG011 blocks without dsh.bundle.patch', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { dsh: undefined } }))
  assert.ok(rules(report).includes('PKG011'))
  assert.equal(report.verdict, 'blocked')
})

test('PKG012 catches ESM syntax in .js without type=module', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { type: undefined } }))
  const found = report.findings.filter((finding) => finding.rule === 'PKG012')
  assert.equal(found.length, 1)
  assert.equal(found[0].file, 'index.js')
  assert.equal(found[0].line, 1)
})

test('PKG013 warns about file: dependencies', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { dependencies: { local: 'file:../local' } } }))
  assert.ok(rules(report).includes('PKG013'))
})

test('PATCH001 reports a parse error with a line number', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'cordis.patch.yml': '- insert:\n\t- name: demo\n' } }))
  const found = report.findings.find((finding) => finding.rule === 'PATCH001')
  assert.ok(found)
  assert.equal(found.line, 2)
})

test('PATCH002 rejects an empty insert list', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'cordis.patch.yml': '- insert: []\n' } }))
  assert.ok(rules(report).includes('PATCH002'))
})

test('PATCH003 requires id and name on every entry', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'cordis.patch.yml': '- insert:\n  - id: demo\n    config: {}\n' } }))
  const found = report.findings.find((finding) => finding.rule === 'PATCH003')
  assert.ok(found)
  assert.match(found.message, /name/)
})

test('PATCH004 warns about duplicate entry ids', async (t) => {
  const patch = '- insert: [{id: demo, name: dsh-demo}, {id: demo, name: dsh-demo}]\n'
  const report = await run(t, pluginFiles({ extra: { 'cordis.patch.yml': patch } }))
  assert.ok(rules(report).includes('PATCH004'))
})

test('PATCH005 warns when a patched package cannot be resolved', async (t) => {
  const patch = '- insert: [{id: demo, name: dsh-definitely-not-installed-xyz}]\n'
  const report = await run(t, pluginFiles({ extra: { 'cordis.patch.yml': patch } }))
  const found = report.findings.find((finding) => finding.rule === 'PATCH005')
  assert.ok(found)
  assert.match(found.message, /dsh-definitely-not-installed-xyz/)
})
