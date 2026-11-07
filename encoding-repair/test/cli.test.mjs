import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { runCli } from '../lib/cli.mjs'
import { makePlugin, makeTempDir, writeFiles, pluginManifest, GBK_CN_TEST, utf16leBom } from './helpers.mjs'

function capture(cwd) {
  const stdout = []
  const stderr = []
  return {
    io: { cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
    out: () => stdout.join(''),
    err: () => stderr.join(''),
  }
}

test('--help prints usage and exits 0', async () => {
  const { io, out } = capture(process.cwd())
  assert.equal(await runCli(['--help'], io), 0)
  assert.match(out(), /用法：encoding-repair/)
})

test('unknown option exits 2', async () => {
  const { io, err } = capture(process.cwd())
  assert.equal(await runCli(['--nope'], io), 2)
  assert.match(err(), /不认识的选项/)
})

test('--root and positional dirs are mutually exclusive', async () => {
  const { io, err } = capture(process.cwd())
  assert.equal(await runCli(['somewhere', '--root', 'elsewhere'], io), 2)
  assert.match(err(), /只能给一个/)
})

test('dry-run exits 1 when a file is fixable', async (t) => {
  const root = await makePlugin('enc-cli-dry-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const { io, out } = capture(root)
  assert.equal(await runCli(['.'], io), 1)
  assert.match(out(), /dry-run/)
})

test('--fix converts and exits 0', async (t) => {
  const root = await makePlugin('enc-cli-fix-', { 'utf16.txt': utf16leBom('中文') })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const { io } = capture(root)
  assert.equal(await runCli(['.', '--fix'], io), 0)
  assert.equal(await fsp.readFile(path.join(root, 'utf16.txt'), 'utf8'), '中文')
})

test('--json is machine readable', async (t) => {
  const root = await makePlugin('enc-cli-json-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const { io, out } = capture(root)
  assert.equal(await runCli(['.', '--json'], io), 1)
  const report = JSON.parse(out())
  assert.equal(report.counts.fixable, 1)
  assert.equal(report.packages.length, 1)
})

test('--out writes both reports', async (t) => {
  const root = await makePlugin('enc-cli-out-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const { io } = capture(root)
  assert.equal(await runCli(['.', '--out', 'reports'], io), 1)
  assert.match(await fsp.readFile(path.join(root, 'reports', 'encoding-repair-report.md'), 'utf8'), /编码修复自检/)
  const json = JSON.parse(await fsp.readFile(path.join(root, 'reports', 'encoding-repair-report.json'), 'utf8'))
  assert.equal(json.counts.fixable, 1)
})

test('--root discovers packages under a workspace', async (t) => {
  const parent = await makeTempDir('enc-cli-root-')
  t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const child = path.join(parent, 'plugin-a')
  await fsp.mkdir(child)
  await writeFiles(child, {
    'package.json': pluginManifest('dsh-root-a'),
    'cordis.patch.yml': '- insert:\n    - id: root-a\n      name: dsh-root-a\n      config: {}\n',
    'index.js': 'export const name = "dsh-root-a"\n',
    'README.md': '# a\n',
    LICENSE: 'MIT\n',
    '.gitignore': 'node_modules/\n',
    'gbk.txt': GBK_CN_TEST,
  })
  const { io, out } = capture(parent)
  assert.equal(await runCli(['--root', '.', '--quiet'], io), 1)
  assert.match(out(), /可修文件/)
})

test('--quiet prints only the conclusion', async (t) => {
  const root = await makePlugin('enc-cli-quiet-', { 'gbk.txt': GBK_CN_TEST })
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const { io, out } = capture(root)
  assert.equal(await runCli(['.', '--quiet'], io), 1)
  assert.equal(out().trim().split('\n').length, 1)
})
