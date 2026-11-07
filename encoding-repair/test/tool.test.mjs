import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { apply, name } from '../index.js'
import { makePlugin, GBK_CN_TEST } from './helpers.mjs'

function makeApply() {
  const state = {
    registered: [],
    sections: [],
    effect(fn) {
      fn()
    },
    systemPrompt: {
      section(section) {
        state.sections.push(section)
      },
    },
    tools: {
      register(tool) {
        state.registered.push(tool)
      },
    },
  }
  return state
}

test('apply registers encoding_repair and a prompt section', () => {
  const state = makeApply()
  apply(state)
  assert.equal(name, 'dsh-encoding-repair')
  assert.equal(state.registered.length, 1)
  assert.equal(state.registered[0].name, 'encoding_repair')
  assert.equal(state.sections[0].name, 'encoding-repair')
})

test('tool executes in dry-run JSON mode', async (t) => {
  const root = await makePlugin('enc-tool-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const state = makeApply()
  apply(state)
  const tool = state.registered[0]
  const output = await tool.execute({ dir: root, json: true })
  const report = JSON.parse(output)
  assert.equal(report.fix, false)
  assert.equal(report.counts.fixable, 1)
  assert.deepEqual(await fsp.readFile(path.join(root, 'gbk.txt')), GBK_CN_TEST)
})

test('tool rejects dir plus root', async () => {
  const state = makeApply()
  apply(state)
  const tool = state.registered[0]
  const output = await tool.execute({ dir: '.', root: '.' })
  assert.match(output, /只能给一个/)
})

test('tool fix writes a backup', async (t) => {
  const root = await makePlugin('enc-tool-fix-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const state = makeApply()
  apply(state)
  const tool = state.registered[0]
  await tool.execute({ dir: root, fix: true, json: true })
  assert.equal(await fsp.readFile(path.join(root, 'gbk.txt'), 'utf8'), '中文测试')
  assert.deepEqual(await fsp.readFile(path.join(root, 'gbk.txt.bak')), GBK_CN_TEST)
})
