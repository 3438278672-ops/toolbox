import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeTree } from './helpers.mjs'
import { readManifest, exportTargets, filesMatcher } from '../lib/manifest.mjs'

test('readManifest reports missing and invalid package.json', async (t) => {
  const dir = await makeTree(t, {})
  const missing = await readManifest(dir)
  assert.equal(missing.manifest, null)
  assert.match(missing.error, /缺少 package\.json/)

  const bad = await makeTree(t, { 'package.json': '{ nope' })
  const invalid = await readManifest(bad)
  assert.equal(invalid.manifest, null)
  assert.match(invalid.error, /JSON 解析失败/)
})

test('exportTargets understands string, object, conditions and subpath patterns', () => {
  assert.deepEqual(exportTargets({ exports: './index.js' }), [
    { subpath: '.', target: './index.js', pattern: false },
  ])
  assert.deepEqual(
    exportTargets({ exports: { '.': { import: './index.mjs', require: './index.cjs' }, './icons/*': './icons/*' } }),
    [
      { subpath: '.', target: './index.mjs', pattern: false },
      { subpath: './icons/*', target: './icons/*', pattern: true },
    ],
  )
  assert.deepEqual(exportTargets({ main: 'lib/main.js' }), [
    { subpath: '.', target: 'lib/main.js', pattern: false },
  ])
  assert.deepEqual(exportTargets({}), [])
})

test('filesMatcher follows npm files semantics plus auto-included files', () => {
  const match = filesMatcher({ files: ['lib', '*.md', 'dist/**'] })
  assert.equal(match('lib/a.mjs'), true)
  assert.equal(match('lib/deep/a.mjs'), true)
  assert.equal(match('libx/a.mjs'), false)
  assert.equal(match('README.md'), true)
  assert.equal(match('docs/notes.md'), true)
  assert.equal(match('dist/a/b.js'), true)
  assert.equal(match('secret.txt'), false)

  assert.equal(filesMatcher({ files: ['README.md'] })('lib/a.mjs'), false)
  assert.equal(filesMatcher({ files: ['README.md'] })('LICENSE'), true)
  assert.equal(filesMatcher({})('anything.txt'), true)
})

test('filesMatcher does not match a directory prefix by string accident', () => {
  const match = filesMatcher({ files: ['lib'] })
  assert.equal(match('lib/a.mjs'), true)
  assert.equal(match('library/a.mjs'), false)
  assert.equal(path.posix.basename('lib/a.mjs'), 'a.mjs')
})
