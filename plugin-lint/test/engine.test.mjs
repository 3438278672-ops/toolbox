import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePackage, applyWaivers, lint } from '../lib/engine.mjs'
import { verdictOf, buildReport, renderMarkdown } from '../lib/report.mjs'
import { makeTree } from './helpers.mjs'

function basePackage(extra = {}) {
  return {
    'package.json': JSON.stringify({
      name: 'fixture-plugin',
      version: '0.1.0',
      description: 'fixture',
      license: 'MIT',
      type: 'module',
      exports: { '.': './index.js' },
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
    'cordis.patch.yml': '- insert:\n    - id: fixture\n      name: fixture-plugin\n      config: {}\n',
    'index.js': 'export const answer = 1\n',
    'README.md': '# fixture\n',
    LICENSE: 'MIT\n',
    '.gitignore': 'node_modules/\n',
    ...extra,
  }
}

test('a minimal valid package is publishable and has a ten-item checklist', async (t) => {
  const dir = await makeTree(t, basePackage())
  const report = await analyzePackage(dir)
  assert.equal(report.verdict, 'publishable')
  assert.deepEqual(report.counts, { error: 0, warn: 0, info: 0 })
  assert.equal(report.checklist.length, 10)
  assert.deepEqual(report.checklist.map((item) => item.id), [
    'manifest',
    'patch',
    'paths',
    'encoding',
    'deps',
    'secrets',
    'repo',
    'display',
    'syntax',
    'config',
  ])
  assert.equal(report.files.published, 6)
})

test('published file stats include an unignored credential file', async (t) => {
  const dir = await makeTree(t, basePackage({ 'credential.json': '{"token":"x"}' }))
  const report = await analyzePackage(dir)
  assert.equal(report.files.published, 7)
  assert.equal(report.files.ignored, 0)
})

test('rules can be switched off and are reported as disabled', async (t) => {
  const dir = await makeTree(
    t,
    basePackage({
      '.pluginlint.json': JSON.stringify({
        rules: { WALK001: 'off' },
        limits: { maxFileBytes: 10 },
      }),
      'big.txt': 'x'.repeat(50),
    }),
  )
  const report = await analyzePackage(dir)
  assert.equal(report.findings.some((item) => item.rule === 'WALK001'), false)
  assert.deepEqual(report.disabledRules, ['WALK001'])
})

test('WALK001 reports large skipped files and stays info', async (t) => {
  const dir = await makeTree(
    t,
    basePackage({
      '.pluginlint.json': JSON.stringify({ limits: { maxFileBytes: 10 } }),
      'big.txt': 'x'.repeat(50),
    }),
  )
  const report = await analyzePackage(dir)
  const walk = report.findings.find((item) => item.rule === 'WALK001')
  assert.ok(walk)
  assert.equal(walk.severity, 'info')
  assert.match(walk.message, /big\.txt/)
  assert.equal(report.verdict, 'publishable')
})

test('applyWaivers removes matching findings and counts usage', () => {
  const findings = [
    { file: 'a.js', rule: 'PAT001', severity: 'error' },
    { file: 'b.js', rule: 'PAT001', severity: 'error' },
  ]
  const waivers = [{ file: 'a.js', rules: ['PAT001'], reason: 'fixture' }]
  const result = applyWaivers(findings, waivers)
  assert.equal(result.kept.length, 1)
  assert.equal(result.kept[0].file, 'b.js')
  assert.equal(result.waived.length, 1)
  assert.deepEqual(result.used, [1])
})

test('an unused waiver becomes CFG004 instead of disappearing', async (t) => {
  const dir = await makeTree(
    t,
    basePackage({
      '.pluginlint.json': JSON.stringify({
        waivers: [{ file: 'nope.js', rules: ['WALK001'], reason: 'fixture' }],
      }),
    }),
  )
  const report = await analyzePackage(dir)
  const cfg = report.findings.find((item) => item.rule === 'CFG004')
  assert.ok(cfg)
  assert.equal(cfg.severity, 'warn')
  assert.equal(report.verdict, 'publishable')
  assert.equal(report.waived, 0)
})

test('maxFindings truncates the report but not the verdict or counts', async (t) => {
  const dir = await makeTree(
    t,
    basePackage({
      '.pluginlint.json': JSON.stringify({ nope1: true, nope2: true, limits: { maxFindings: 1 } }),
    }),
  )
  const report = await analyzePackage(dir)
  assert.equal(report.truncated, true)
  assert.ok(report.findings.some((item) => item.rule === 'WALK003'))
  assert.equal(report.counts.info, 3)
  assert.equal(report.verdict, 'publishable')
})

test('verdictOf honours failOn thresholds and none', () => {
  const warn = [{ severity: 'warn' }]
  const error = [{ severity: 'error' }]
  assert.equal(verdictOf(warn, 'error'), 'publishable')
  assert.equal(verdictOf(warn, 'warn'), 'blocked')
  assert.equal(verdictOf(error, 'error'), 'blocked')
  assert.equal(verdictOf(error, 'none'), 'publishable')
})

test('lint builds the JSON report and Markdown checklist', async (t) => {
  const dir = await makeTree(t, basePackage())
  const report = await lint({ dirs: [dir], now: new Date('2026-11-08T00:00:00.000Z') })
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.generatedAt, '2026-11-08T00:00:00.000Z')
  assert.equal(report.tool.name, 'dsh-plugin-lint')
  assert.equal(report.verdict, 'publishable')
  assert.equal(report.packages.length, 1)
  assert.deepEqual(report.counts, { error: 0, warn: 0, info: 0 })

  const markdown = renderMarkdown(report)
  assert.match(markdown, /^# 插件发布前自检/m)
  assert.match(markdown, /结论：\*\*可发\*\*/)
  assert.match(markdown, /### 检查单/)
  assert.match(markdown, /- \[x\] 清单与入口完整/)
})

test('buildReport aggregates package counts and disabled rules', () => {
  const report = buildReport({
    packages: [
      {
        name: 'a',
        dir: 'A',
        verdict: 'blocked',
        counts: { error: 1, warn: 0, info: 0 },
        waived: 2,
        disabledRules: ['DOC001'],
        checklist: [],
        findings: [],
        files: { published: 1, ignored: 0, pruned: 0, binary: 0, text: 1, large: 0 },
        truncated: false,
      },
      {
        name: 'b',
        dir: 'B',
        verdict: 'publishable',
        counts: { error: 0, warn: 1, info: 0 },
        waived: 0,
        disabledRules: ['PAT001'],
        checklist: [],
        findings: [],
        files: { published: 1, ignored: 0, pruned: 0, binary: 0, text: 1, large: 0 },
        truncated: false,
      },
    ],
    now: new Date('2026-11-08T00:00:00.000Z'),
  })
  assert.equal(report.verdict, 'blocked')
  assert.deepEqual(report.counts, { error: 1, warn: 1, info: 0 })
  assert.equal(report.waived, 2)
  assert.deepEqual(report.disabledRules, ['DOC001', 'PAT001'])
})
