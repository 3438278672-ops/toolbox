import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeTree, pluginFiles } from './helpers.mjs'
import { apply } from '../index.js'

function fakeContext() {
  const registered = []
  const sections = []
  return {
    registered,
    sections,
    effect(fn) {
      fn()
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
      },
    },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
  }
}

test('apply registers the plugin_lint tool and a system prompt section', () => {
  const ctx = fakeContext()
  apply(ctx)
  assert.equal(ctx.registered.length, 1)
  const tool = ctx.registered[0]
  assert.equal(tool.name, 'plugin_lint')
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].name, 'plugin-lint')
})

test('execute reports a clean package in Markdown', async (t) => {
  const root = await makeTree(t, pluginFiles())
  const ctx = fakeContext()
  apply(ctx)
  const output = await ctx.registered[0].execute({ dir: root, syntax: false })
  assert.match(output, /结论：\*\*可发\*\*/)
})

test('execute returns JSON when json is true', async (t) => {
  const root = await makeTree(t, pluginFiles())
  const ctx = fakeContext()
  apply(ctx)
  const output = await ctx.registered[0].execute({ dir: root, syntax: false, json: true })
  const report = JSON.parse(output)
  assert.equal(report.verdict, 'publishable')
})

test('execute rejects dir and root together', async () => {
  const ctx = fakeContext()
  apply(ctx)
  const output = await ctx.registered[0].execute({ dir: '.', root: '.' })
  assert.match(output, /参数冲突/)
})

test('execute writes both report files when out is given', async (t) => {
  const root = await makeTree(t, pluginFiles())
  const out = await mkdtemp(path.join(tmpdir(), 'plugin-lint-tool-out-'))
  const ctx = fakeContext()
  apply(ctx)
  const output = await ctx.registered[0].execute({ dir: root, syntax: false, out })
  assert.match(output, /完整报告/)
  const markdown = await readFile(path.join(out, 'plugin-lint-report.md'), 'utf8')
  assert.match(markdown, /# 插件发布前自检/)
})
