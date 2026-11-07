import test from 'node:test'
import assert from 'node:assert/strict'
import { makeTree } from './helpers.mjs'
import { discoverPackages } from '../lib/discover.mjs'

function pkg(name) {
  return JSON.stringify({ name, dsh: { bundle: { patch: './cordis.patch.yml' } } })
}

test('discovery finds nested plugin packages and stops at each package', async (t) => {
  const root = await makeTree(t, {
    'a/package.json': pkg('a'),
    'a/index.js': 'export const a = 1\n',
    'a/nested/package.json': pkg('nested'),
    'b/package.json': '{"name":"b"}\n',
    'b/cordis.patch.yml': '- insert: []\n',
    'c/package.json': '{"name":"c"}\n',
  })
  const { packages } = await discoverPackages(root, { depth: 3 })
  assert.deepEqual(
    packages.map((dir) => dir.split(/[\\/]/).pop()),
    ['a', 'b'],
  )
})

test('discovery respects the depth limit', async (t) => {
  const root = await makeTree(t, {
    'one/package.json': pkg('one'),
    'one/two/package.json': pkg('two'),
  })
  assert.equal((await discoverPackages(root, { depth: 1 })).packages.length, 1)
  assert.equal((await discoverPackages(root, { depth: 1 })).packages[0].endsWith('one'), true)
  assert.equal((await discoverPackages(root, { depth: 0 })).packages.length, 0)
})

test('discovery skips node_modules, hidden directories and ignore globs', async (t) => {
  const root = await makeTree(t, {
    'node_modules/x/package.json': pkg('x'),
    'node_modules/x/cordis.patch.yml': '- insert: []\n',
    '.hidden/package.json': pkg('hidden'),
    '.hidden/cordis.patch.yml': '- insert: []\n',
    'skip/package.json': pkg('skip'),
    'skip/cordis.patch.yml': '- insert: []\n',
    'keep/package.json': pkg('keep'),
  })
  const { packages } = await discoverPackages(root, { depth: 3, ignore: ['skip/**'] })
  assert.equal(packages.length, 1)
  assert.equal(packages[0].endsWith('keep'), true)
})

test('discovery does not treat the scan root itself as a package', async (t) => {
  const root = await makeTree(t, {
    'package.json': pkg('root'),
    'cordis.patch.yml': '- insert: []\n',
  })
  const { packages } = await discoverPackages(root, { depth: 3 })
  assert.equal(packages.length, 0)
})
