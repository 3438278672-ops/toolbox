// .gitignore 子集 → matcher。语义按 git 文档实现，最后匹配的规则胜出。

const CACHE = new Map()

function escapeRegex(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function globToRegex(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      const next = pattern[++i]
      if (next !== undefined) out += escapeRegex(next)
      continue
    }
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        const start = i
        while (pattern[i + 1] === '*') i++
        const prev = pattern[start - 1]
        const next = pattern[i + 1]
        if ((prev === undefined || prev === '/') && (next === undefined || next === '/')) {
          if (next === '/') {
            out += '(?:.*/)?'
            i++
          } else {
            out += '.*'
          }
        } else {
          out += '.*'
        }
        continue
      }
      out += '[^/]*'
      continue
    }
    if (ch === '?') {
      out += '[^/]'
      continue
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end !== -1) {
        let cls = pattern.slice(i + 1, end)
        if (cls.startsWith('!')) cls = '^' + cls.slice(1)
        out += '[' + cls + ']'
        i = end
        continue
      }
    }
    out += escapeRegex(ch)
  }
  return out
}

function normalizeRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function parseLine(raw) {
  let line = raw.replace(/\r$/, '')
  if (!line || line.startsWith('#')) return null
  if (line.startsWith('\\#')) line = line.slice(1)
  line = line.replace(/(?<!\\)\s+$/, '')
  if (!line) return null

  let negated = false
  if (line.startsWith('!')) {
    negated = true
    line = line.slice(1)
    if (!line) return null
  } else if (line.startsWith('\\!')) {
    line = line.slice(1)
  }

  let dirOnly = false
  if (line.endsWith('/')) {
    dirOnly = true
    line = line.replace(/\/+$/, '')
    if (!line) return null
  }

  let anchored = false
  if (line.startsWith('/')) {
    anchored = true
    line = line.replace(/^\/+/, '')
    if (!line) return null
  } else if (line.includes('/')) {
    anchored = true
  }

  return { pattern: line, negated, dirOnly, anchored }
}

export function parseGitignore(text) {
  const source = String(text)
  const cached = CACHE.get(source)
  if (cached) return cached

  const rules = []
  for (const raw of source.split('\n')) {
    const rule = parseLine(raw)
    if (!rule) continue
    const regex = new RegExp((rule.anchored ? '^' : '(?:^|/)') + globToRegex(rule.pattern) + '$')
    rules.push({ ...rule, regex })
  }

  const matcher = {
    rules,
    match(rel, isDir = false) {
      const path = normalizeRel(rel)
      let result = { ignored: false, rule: null }
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue
        if (!rule.regex.test(path)) continue
        result = { ignored: !rule.negated, rule: (rule.negated ? '!' : '') + rule.pattern }
      }
      return result
    },
  }
  CACHE.set(source, matcher)
  return matcher
}

export function combineMatchers(matchers) {
  const list = matchers.filter(Boolean)
  return {
    match(rel, isDir = false) {
      let result = { ignored: false, rule: null }
      for (const matcher of list) {
        const hit = matcher.match(rel, isDir)
        if (hit.rule !== null) result = hit
      }
      return result
    },
  }
}
