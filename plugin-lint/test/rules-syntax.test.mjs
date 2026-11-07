import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree, pluginFiles } from './helpers.mjs'
import { analyzePackage } from '../lib/engine.mjs'

async function run(t, files, options = {}) {
  const dir = await makeTree(t, files)
  return analyzePackage(dir, options)
}

function of(report, id) {
  return report.findings.filter((finding) => finding.rule === id)
}

test('a clean file produces no syntax findings', async (t) => {
  const report = await run(t, pluginFiles(), {
    syntaxOptions: { runOne: async () => ({ ok: true }) },
  })
  assert.equal(of(report, 'SYN001').length, 0)
  assert.equal(of(report, 'SYN002').length, 0)
})

test('a failed node --check becomes SYN001 error', async (t) => {
  const report = await run(t, pluginFiles(), {
    syntaxOptions: {
      runOne: async (execPath, file) => ({
        ok: false,
        code: 1,
        stderr: `${file}:1 SyntaxError: Unexpected token\n`,
      }),
    },
  })
  const found = of(report, 'SYN001')
  assert.equal(found.length, 1)
  assert.equal(found[0].severity, 'error')
  assert.match(found[0].message, /SyntaxError/)
})

test('a spawn failure becomes SYN002 info, not a syntax error', async (t) => {
  const report = await run(t, pluginFiles(), {
    syntaxOptions: { runOne: async () => ({ ok: false, spawnError: new Error('EPERM') }) },
  })
  assert.equal(of(report, 'SYN001').length, 0)
  const found = of(report, 'SYN002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /语法未检查/)
})

test('config syntaxCheck:false skips checks and marks the checklist skipped', async (t) => {
  let calls = 0
  const report = await run(
    t,
    pluginFiles({ extra: { '.pluginlint.json': '{"syntaxCheck":false}' } }),
    {
      syntaxOptions: {
        runOne: async () => {
          calls += 1
          return { ok: true }
        },
      },
    },
  )
  assert.equal(calls, 0)
  assert.equal(of(report, 'SYN001').length, 0)
  assert.equal(of(report, 'SYN002').length, 0)
  const item = report.checklist.find((entry) => entry.id === 'syntax')
  assert.equal(item.status, 'skipped')
})

test('syntaxMaxFiles reports how many files were skipped', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      extra: {
        '.pluginlint.json': JSON.stringify({ limits: { syntaxMaxFiles: 1 } }),
        'a.mjs': 'export const a = 1\n',
        'b.mjs': 'export const b = 2\n',
      },
    }),
    { syntaxOptions: { runOne: async () => ({ ok: true }) } },
  )
  const found = of(report, 'SYN002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /跳过 2 个文件/)
})

test('plain .js files without type:"module" are reported as unchecked', async (t) => {
  const report = await run(
    t,
    pluginFiles({
      manifest: { type: undefined },
      extra: { 'legacy.js': 'module.exports = 1\n' },
    }),
    { syntaxOptions: { runOne: async () => ({ ok: true }) } },
  )
  const found = of(report, 'SYN002')
  assert.equal(found.length, 1)
  assert.match(found[0].message, /\.js 文件/)
  assert.equal(of(report, 'SYN001').length, 0)
})
