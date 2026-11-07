import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGitignore, combineMatchers } from '../lib/gitignore.mjs'

test('basename pattern matches at any depth', () => {
  const matcher = parseGitignore('*.log\n')
  assert.deepEqual(matcher.match('a.log', false), { ignored: true, rule: '*.log' })
  assert.equal(matcher.match('sub/a.log', false).ignored, true)
  assert.equal(matcher.match('a.txt', false).ignored, false)
})

test('leading slash anchors to package root', () => {
  const matcher = parseGitignore('/build/\n')
  assert.equal(matcher.match('build', true).ignored, true)
  assert.equal(matcher.match('sub/build', true).ignored, false)
  assert.equal(matcher.match('build', false).ignored, false)
})

test('trailing slash matches directories only', () => {
  const matcher = parseGitignore('cache/\n')
  assert.equal(matcher.match('cache', true).ignored, true)
  assert.equal(matcher.match('cache', false).ignored, false)
  assert.equal(matcher.match('sub/cache', true).ignored, true)
})

test('globstar spans directories', () => {
  const matcher = parseGitignore('docs/**/*.md\n')
  assert.equal(matcher.match('docs/a.md', false).ignored, true)
  assert.equal(matcher.match('docs/x/a.md', false).ignored, true)
  assert.equal(matcher.match('other/a.md', false).ignored, false)
})

test('negation overrides an earlier match', () => {
  const matcher = parseGitignore('*.md\n!keep.md\n')
  assert.equal(matcher.match('keep.md', false).ignored, false)
  assert.equal(matcher.match('other.md', false).ignored, true)
})

test('comment and blank lines are ignored', () => {
  const matcher = parseGitignore('# comment\n\n*.tmp\n')
  assert.equal(matcher.rules.length, 1)
  assert.equal(matcher.match('x.tmp', false).ignored, true)
})

test('combineMatchers lets a deeper matcher win', () => {
  const root = parseGitignore('*.md\n')
  const nested = parseGitignore('!keep.md\n')
  const combined = combineMatchers([root, nested])
  assert.equal(combined.match('docs/keep.md', false).ignored, false)
  assert.equal(combined.match('docs/other.md', false).ignored, true)
})
