import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePatchYaml } from '../lib/patch.mjs'

test('parses a block insert and keeps entry line numbers', () => {
  const text = [
    '- insert:',
    '    - id: plugin-lint',
    '      name: dsh-plugin-lint',
    '      config: {}',
    '',
  ].join('\n')
  const result = parsePatchYaml(text)
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, [{ id: 'plugin-lint', name: 'dsh-plugin-lint', line: 2 }])
})

test('accepts two-space nesting under the dash', () => {
  const result = parsePatchYaml('- insert:\n  - id: x\n    name: y\n')
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, [{ id: 'x', name: 'y', line: 2 }])
})

test('accepts flow arrays and !!js values', () => {
  const result = parsePatchYaml('- insert: [{ id: a, name: b, config: { enabled: !!js true } }]\n')
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, [{ id: 'a', name: 'b', line: null }])
})

test('keeps config nested under an entry', () => {
  const result = parsePatchYaml('- insert:\n  - id: a\n    config:\n      dir: D:\\\\x\n      list: [1, 2]\n')
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, [{ id: 'a', name: null, line: 2 }])
})

test('fails with a line number for tabs, empty files and missing insert', () => {
  const tab = parsePatchYaml('- insert:\n\t- id: x\n')
  assert.equal(tab.ok, false)
  assert.match(tab.error, /tab/)
  assert.equal(tab.line, 2)

  const empty = parsePatchYaml('')
  assert.equal(empty.ok, false)
  assert.equal(empty.line, 1)

  const noInsert = parsePatchYaml('- override:\n  - id: x\n')
  assert.equal(noInsert.ok, false)
  assert.match(noInsert.error, /没有 insert/)
})

test('does not mistake a quoted scalar containing a colon for a map', () => {
  const result = parsePatchYaml('- insert:\n  - "a: b"\n')
  assert.equal(result.ok, false)
  assert.match(result.error, /必须是 map/)
})
