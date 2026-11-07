import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree, pluginFiles, without } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir, { syntaxCheck: false })
}

function of(report, id) {
  return report.findings.filter((finding) => finding.rule === id)
}

test('DOC001 warns when README.md is missing', async (t) => {
  const report = await run(t, without(pluginFiles(), 'README.md'))
  assert.equal(of(report, 'DOC001').length, 1)
  assert.equal(of(report, 'DOC001')[0].severity, 'warn')
})

test('DOC002 warns when license is declared but LICENSE is missing', async (t) => {
  const report = await run(t, without(pluginFiles(), 'LICENSE'))
  assert.equal(of(report, 'DOC002').length, 1)
})

test('DSP001 blocks a declared icon that does not exist', async (t) => {
  const report = await run(t, pluginFiles({ manifest: { icon: './icon.svg' } }))
  assert.equal(of(report, 'DSP001').length, 1)
  assert.equal(of(report, 'DSP001')[0].severity, 'error')
})

test('DSP002 warns about an oversized icon', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { icon: './icon.svg' },
      extra: { 'icon.svg': 'x'.repeat(300 * 1024) },
    }),
  )
  const found = of(report, 'DSP002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /图标过大/)
})

test('DSP002 warns about an unrecognized icon format', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { icon: './icon.ico' },
      extra: { 'icon.ico': 'icon\n' },
    }),
  )
  const found = of(report, 'DSP002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /格式不可识别/)
})

test('DSP003 blocks invalid locale JSON', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'locale/zh.json': '{bad' } }))
  const found = of(report, 'DSP003')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
})

test('DSP004 warns about missing meta fields', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'locale/zh.json': '{}' } }))
  assert.equal(of(report, 'DSP004').length, 2)
  assert.equal(of(report, 'DSP004')[0].severity, 'warn')
})

test('DSP005 warns when locale files are not exported', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: { 'locale/zh.json': '{"meta":{"title":"x","description":"y"}}\n' },
    }),
  )
  assert.equal(of(report, 'DSP005').length, 1)
})

test('DSP005 passes when exports include the locale pattern', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: {
        exports: { '.': './index.js', './locale/*.json': './locale/*.json' },
      },
      extra: { 'locale/zh.json': '{"meta":{"title":"x","description":"y"}}\n' },
    }),
  )
  assert.equal(of(report, 'DSP005').length, 0)
})
