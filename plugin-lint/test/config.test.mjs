import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, loadConfig, DEFAULT_CONFIG, CONFIG_FILE } from '../lib/config.mjs'
import { makeTree } from './helpers.mjs'

test('normalizeConfig merges valid values over defaults', () => {
  const { config, issues } = normalizeConfig(
    {
      ignore: ['fixtures/**', ''],
      rules: { PAT001: 'warn' },
      failOn: 'warn',
      syntaxCheck: false,
      limits: { maxFiles: 10, syntaxConcurrency: 2 },
      discovery: { depth: 1 },
      waivers: [{ file: 'lib/patterns.mjs', rules: ['PAT001'], reason: '规则表本身要写绝对路径' }],
    },
    { knownRuleIds: ['PAT001', 'SEC001'] },
  )
  assert.deepEqual(issues, [])
  assert.deepEqual(config.ignore, ['fixtures/**'])
  assert.deepEqual(config.rules, { PAT001: 'warn' })
  assert.equal(config.failOn, 'warn')
  assert.equal(config.syntaxCheck, false)
  assert.equal(config.limits.maxFiles, 10)
  assert.equal(config.limits.maxFindings, DEFAULT_CONFIG.limits.maxFindings)
  assert.equal(config.discovery.depth, 1)
  assert.deepEqual(config.waivers, [
    { file: 'lib/patterns.mjs', rules: ['PAT001'], reason: '规则表本身要写绝对路径' },
  ])
})

test('normalizeConfig reports unknown fields and bad types', () => {
  const { issues } = normalizeConfig({ nope: true, ignore: 'x', failOn: 'fatal', syntaxCheck: 'yes' })
  const rules = issues.map((item) => item.rule)
  assert.equal(rules.filter((id) => id === 'CFG002').length, 4)
})

test('normalizeConfig rejects unknown rule ids and invalid levels', () => {
  const { config, issues } = normalizeConfig(
    { rules: { NOPE001: 'warn', PAT001: 'loud' } },
    { knownRuleIds: ['PAT001'] },
  )
  assert.deepEqual(config.rules, {})
  assert.equal(issues.filter((item) => item.rule === 'CFG003').length, 2)
  assert.match(issues[0].message, /NOPE001/)
  assert.match(issues[1].message, /loud/)
})

test('normalizeConfig only accepts complete waivers', () => {
  const { config, issues } = normalizeConfig(
    {
      waivers: [
        { file: 'a.mjs', rules: ['PAT001'] },
        { file: 'b.mjs', rules: ['NOPE001'], reason: 'x' },
        { file: '', rules: ['PAT001'], reason: 'x' },
        { file: 'c.mjs', rules: [], reason: 'x' },
      ],
    },
    { knownRuleIds: ['PAT001'] },
  )
  assert.deepEqual(config.waivers, [])
  assert.equal(issues.length, 4)
  assert.equal(issues.filter((item) => item.rule === 'CFG004').length, 3)
  assert.equal(issues.filter((item) => item.rule === 'CFG003').length, 1)
})

test('normalizeConfig refuses discovery at package level', () => {
  const { issues } = normalizeConfig({ discovery: { depth: 1 } }, { isPackageLevel: true })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].rule, 'CFG004')
})

test('normalizeConfig bounds syntaxConcurrency', () => {
  for (const value of [0, 17, 1.5]) {
    const { issues } = normalizeConfig({ limits: { syntaxConcurrency: value } })
    assert.equal(issues[0].rule, 'CFG002')
  }
})

test('loadConfig handles missing, invalid and valid files', async (t) => {
  const missing = await loadConfig((await makeTree(t, {})))
  assert.equal(missing.exists, false)
  assert.deepEqual(missing.issues, [])
  assert.equal(missing.config.failOn, 'error')

  const broken = await makeTree(t, { [CONFIG_FILE]: '{ broken' })
  const invalid = await loadConfig(broken)
  assert.equal(invalid.exists, true)
  assert.equal(invalid.issues[0].rule, 'CFG001')
  assert.equal(invalid.config.failOn, 'error')

  const good = await makeTree(t, {
    [CONFIG_FILE]: JSON.stringify({ failOn: 'warn', rules: { PAT001: 'off' } }),
  })
  const loaded = await loadConfig(good, { knownRuleIds: ['PAT001'] })
  assert.deepEqual(loaded.issues, [])
  assert.equal(loaded.config.failOn, 'warn')
  assert.equal(loaded.config.rules.PAT001, 'off')
})
