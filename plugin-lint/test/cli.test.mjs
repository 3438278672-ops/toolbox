import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeTree, pluginFiles, without, winPath } from './helpers.mjs'
import { runCli } from '../lib/cli.mjs'

function prefixed(prefix, files) {
  return Object.fromEntries(Object.entries(files).map(([rel, body]) => [`${prefix}/${rel}`, body]))
}

function capture() {
  let stdout = ''
  let stderr = ''
  return {
    io: {
      cwd: process.cwd(),
      stdout: (text) => {
        stdout += text
      },
      stderr: (text) => {
        stderr += text
      },
    },
    get stdout() {
      return stdout
    },
    get stderr() {
      return stderr
    },
  }
}

test('--json returns parseable JSON and exit 0 for a clean package', async (t) => {
  const root = await makeTree(t, prefixed('pkg', pluginFiles()))
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--json'], output.io)
  assert.equal(code, 0)
  const report = JSON.parse(output.stdout)
  assert.equal(report.verdict, 'publishable')
  assert.equal(report.packages.length, 1)
  assert.equal(report.packages[0].name, 'dsh-demo')
})

test('a hardcoded path blocks the package and exits 1', async (t) => {
  const files = pluginFiles({ extra: { 'index.js': `const p = '${winPath('Users', 'me')}'\n` } })
  const root = await makeTree(t, prefixed('pkg', files))
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--json'], output.io)
  assert.equal(code, 1)
  const report = JSON.parse(output.stdout)
  assert.equal(report.verdict, 'blocked')
  assert.equal(report.packages[0].findings.some((item) => item.rule === 'PAT001'), true)
})

test('--fail-on warn turns a warning into a block', async (t) => {
  const root = await makeTree(t, prefixed('pkg', without(pluginFiles(), 'README.md')))
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--fail-on', 'warn', '--json'], output.io)
  assert.equal(code, 1)
  assert.equal(JSON.parse(output.stdout).verdict, 'blocked')
})

test('--out writes both report files', async (t) => {
  const root = await makeTree(t, prefixed('pkg', pluginFiles()))
  const outDir = await mkdtemp(path.join(tmpdir(), 'plugin-lint-out-'))
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--out', outDir], output.io)
  assert.equal(code, 0)
  const markdown = await readFile(path.join(outDir, 'plugin-lint-report.md'), 'utf8')
  const json = JSON.parse(await readFile(path.join(outDir, 'plugin-lint-report.json'), 'utf8'))
  assert.match(markdown, /# 插件发布前自检/)
  assert.equal(json.schemaVersion, 1)
})

test('--help exits 0 and prints usage', async () => {
  const output = capture()
  assert.equal(await runCli(['--help'], output.io), 0)
  assert.match(output.stdout, /用法/)
})

test('unknown options exit 2', async () => {
  const output = capture()
  assert.equal(await runCli(['--nope'], output.io), 2)
  assert.match(output.stderr, /不认识的选项/)
})

test('--root and a positional directory are mutually exclusive', async () => {
  const output = capture()
  assert.equal(await runCli(['--root', '.', '.'], output.io), 2)
  assert.match(output.stderr, /只能给一个/)
})

test('an empty root reports DISCOVER001 and still exits 0', async (t) => {
  const root = await makeTree(t, { 'notes.txt': 'hello\n' })
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--json'], output.io)
  assert.equal(code, 0)
  const report = JSON.parse(output.stdout)
  assert.equal(report.packages.length, 0)
  assert.equal(report.findings[0].rule, 'DISCOVER001')
})

test('--quiet prints only a conclusion line', async (t) => {
  const root = await makeTree(t, prefixed('pkg', pluginFiles()))
  const output = capture()
  const code = await runCli(['--root', root, '--no-syntax', '--quiet'], output.io)
  assert.equal(code, 0)
  assert.match(output.stdout, /^结论：可发/)
})
