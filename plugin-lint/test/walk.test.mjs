import test from 'node:test'
import assert from 'node:assert/strict'
import { walkPackage, scopeOf, classifyFile } from '../lib/walk.mjs'
import { makeTree } from './helpers.mjs'

test('walkPackage splits published / ignored / pruned', async (t) => {
  const dir = await makeTree(t, {
    '.gitignore': 'credential.json\ndist/\n',
    'index.js': 'export const x = 1\n',
    'credential.json': '{"token":"x"}',
    'dist/out.js': 'export const y = 1\n',
    'node_modules/pkg/index.js': 'module.exports = 1\n',
    'docs/guide.md': '# guide\n',
    'utf16.txt': Buffer.from('\uFEFFhello', 'utf16le'),
    'bin.dat': Buffer.from([0, 1, 2, 3]),
    'big.txt': Buffer.alloc(2048, 0x61),
  })

  const result = await walkPackage(dir, { limits: { maxFileBytes: 1024, maxFiles: 100 } })
  const rels = result.files.map((f) => f.rel)
  assert.deepEqual(rels, ['.gitignore', 'big.txt', 'bin.dat', 'docs/guide.md', 'index.js', 'utf16.txt'])

  assert.deepEqual(result.ignoredFiles.map((f) => f.rel), ['credential.json'])
  assert.equal(result.ignoredFiles[0].rule, 'credential.json')

  const dist = result.prunedDirs.find((d) => d.rel === 'dist')
  assert.deepEqual(dist, { rel: 'dist', reason: 'gitignore', ignored: true })
  const modules = result.prunedDirs.find((d) => d.rel === 'node_modules')
  assert.deepEqual(modules, { rel: 'node_modules', reason: 'vendor', ignored: false })

  assert.equal(result.files.find((f) => f.rel === 'utf16.txt').kind, 'text')
  assert.equal(result.files.find((f) => f.rel === 'bin.dat').kind, 'binary')
  assert.equal(result.files.find((f) => f.rel === 'big.txt').kind, 'large')
  assert.deepEqual(result.largeSkipped, ['big.txt'])

  assert.deepEqual(result.stats, {
    published: 6,
    ignored: 1,
    pruned: 2,
    binary: 1,
    text: 4,
    large: 1,
  })
  assert.equal(result.truncated, false)
})

test('nested .gitignore applies to its own directory', async (t) => {
  const dir = await makeTree(t, {
    '.gitignore': 'dist/\n',
    'src/.gitignore': '*.tmp\n',
    'src/a.tmp': 'x',
    'src/a.js': 'export const x = 1\n',
  })
  const result = await walkPackage(dir)
  assert.deepEqual(result.ignoredFiles.map((f) => f.rel), ['src/a.tmp'])
  assert.ok(result.files.some((f) => f.rel === 'src/a.js'))
})

test('maxFiles stops the walk and reports truncation', async (t) => {
  const dir = await makeTree(t, {
    'a.txt': 'a',
    'b.txt': 'b',
    'c.txt': 'c',
  })
  const result = await walkPackage(dir, { limits: { maxFiles: 2 } })
  assert.equal(result.truncated, true)
  assert.deepEqual(result.files.map((f) => f.rel), ['a.txt', 'b.txt'])
})

test('scopeOf uses path table, not extension guessing', () => {
  assert.equal(scopeOf('test/a.mjs'), 'test')
  assert.equal(scopeOf('src/a.test.mjs'), 'test')
  assert.equal(scopeOf('fixtures/data.json'), 'test')
  assert.equal(scopeOf('docs/guide.md'), 'docs')
  assert.equal(scopeOf('README.md'), 'docs')
  assert.equal(scopeOf('LICENSE'), 'docs')
  assert.equal(scopeOf('bin/run.mjs'), 'runtime')
  assert.equal(scopeOf('src/a.mjs'), 'runtime')
})

test('classifyFile treats UTF-16 BOM as text and NUL as binary', async (t) => {
  const dir = await makeTree(t, {
    'utf16.txt': Buffer.from('\uFEFFhello', 'utf16le'),
    'bin.dat': Buffer.from([0, 1, 2]),
    'plain.txt': 'hello',
  })
  const utf16 = await classifyFile(`${dir}/utf16.txt`, 12, 1024)
  const binary = await classifyFile(`${dir}/bin.dat`, 3, 1024)
  const plain = await classifyFile(`${dir}/plain.txt`, 5, 1024)
  assert.equal(utf16.kind, 'text')
  assert.equal(binary.kind, 'binary')
  assert.equal(plain.kind, 'text')
})
