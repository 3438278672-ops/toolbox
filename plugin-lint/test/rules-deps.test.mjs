import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTree, pluginFiles } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir)
}

function of(report, id) {
  return report.findings.filter((finding) => finding.rule === id)
}

function packageInNodeModules(name) {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
    [`node_modules/${name}/index.js`]: 'module.exports = 1\n',
  }
}

test('DEP001 catches an unresolvable relative import', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'index.js': "import './missing.js'\n" } }))
  assert.equal(of(report, 'DEP001').length, 1)
  assert.equal(of(report, 'DEP001')[0].severity, 'error')
})

test('DEP002 catches an unresolvable bare import', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'index.js': "import 'missing-pkg-xyz'\n" } }))
  assert.equal(of(report, 'DEP002').length, 1)
})

test('DEP003 warns about a resolvable package missing from the manifest', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: { 'index.js': "import 'foo'\n", ...packageInNodeModules('foo') },
    }),
  )
  assert.equal(of(report, 'DEP003').length, 1)
  assert.equal(of(report, 'DEP003')[0].severity, 'warn')
})

test('DEP004 rejects a runtime import from devDependencies', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { devDependencies: { bar: '^1.0.0' } },
      extra: { 'index.js': "import 'bar'\n", ...packageInNodeModules('bar') },
    }),
  )
  assert.equal(of(report, 'DEP004').length, 1)
  assert.equal(of(report, 'DEP004')[0].severity, 'error')
})

test('DEP005 rejects a relative import that resolves outside the package', async (t) => {
  const files = {
    'shared.js': 'export const shared = 1\n',
    ...Object.fromEntries(
      Object.entries(pluginFiles({ extra: { 'index.js': "import '../shared.js'\n" } })).map(([rel, body]) => [
        `pkg/${rel}`,
        body,
      ]),
    ),
  }
  const root = await makeTree(t, files)
  const report = await analyzePackage(path.join(root, 'pkg'))
  assert.equal(of(report, 'DEP005').length, 1)
})

test('DEP006 reports a non-literal dynamic import as info', async (t) => {
  const report = await run(t, pluginFiles({ extra: { 'index.js': "const name = './x.js'\nconst m = import(name)\n" } }))
  assert.equal(of(report, 'DEP006').length, 1)
  assert.equal(of(report, 'DEP006')[0].severity, 'info')
})

test('PKG010 catches a reachable file that is not in files', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { files: ['index.js', 'cordis.patch.yml'] },
      extra: { 'index.js': "import './lib/extra.js'\n", 'lib/extra.js': 'export const extra = 1\n' },
    }),
  )
  const found = of(report, 'PKG010')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /lib\/extra\.js/)
})

test('PKG010 passes when files covers the reachable tree', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { files: ['index.js', 'lib', 'cordis.patch.yml'] },
      extra: { 'index.js': "import './lib/extra.js'\n", 'lib/extra.js': 'export const extra = 1\n' },
    }),
  )
  assert.equal(of(report, 'PKG010').length, 0)
})
