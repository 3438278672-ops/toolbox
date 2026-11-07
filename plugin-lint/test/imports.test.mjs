import test from 'node:test'
import assert from 'node:assert/strict'
import { extractImports } from '../lib/imports.mjs'

test('extractImports finds static, export, dynamic and require forms', () => {
  const source = [
    "import a from './a.js'",
    "import './side.js'",
    "export { b } from './b.js'",
    "const c = await import('./c.js')",
    "const d = require('./d.js')",
    'const e = import(expr)',
    'const s = "import x from \'./fake.js\'"',
    "// import y from './comment.js'",
    'import.meta.url',
  ].join('\n')
  const items = extractImports(source)
  assert.deepEqual(
    items.map((item) => item.spec),
    ['./a.js', './side.js', './b.js', './c.js', './d.js', null],
  )
  assert.equal(items[3].dynamic, true)
  assert.equal(items[1].kind, 'import')
  assert.equal(items[2].kind, 'export')
  assert.equal(items[4].kind, 'require')
  assert.equal(items[5].nonliteral, true)
})

test('extractImports keeps line and column', () => {
  const source = "const a = 1\nimport x from './x.js'\n"
  const [item] = extractImports(source)
  assert.equal(item.line, 2)
  assert.ok(item.column > 0)
})
