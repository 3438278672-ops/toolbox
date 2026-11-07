// 静态 import / export / require 抽取：跳过注释与字符串，只认真正的模块说明符。
const IDENT_START = /[A-Za-z_$]/
const IDENT_PART = /[A-Za-z0-9_$]/

function isQuote(ch) {
  return ch === "'" || ch === '"' || ch === '`'
}

function skipLineComment(source, index) {
  const next = source.indexOf('\n', index)
  return next < 0 ? source.length : next
}

function skipBlockComment(source, index) {
  const next = source.indexOf('*/', index + 2)
  return next < 0 ? source.length : next + 2
}

function readString(source, index) {
  const quote = source[index]
  let i = index + 1
  let value = ''
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      value += source[i + 1] ?? ''
      i += 2
      continue
    }
    if (ch === quote) return { value, end: i + 1 }
    if (ch === '\n') return { value, end: i }
    value += ch
    i += 1
  }
  return { value, end: source.length }
}

function skipTrivia(source, index) {
  let i = index
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
      continue
    }
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    break
  }
  return i
}

function readIdent(source, index) {
  let i = index
  while (i < source.length && IDENT_PART.test(source[i])) i += 1
  return { value: source.slice(index, i), end: i }
}

function findFrom(source, index) {
  let i = index
  let depth = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      i = skipLineComment(source, i)
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i = skipBlockComment(source, i)
      continue
    }
    if (isQuote(ch)) {
      i = readString(source, i).end
      continue
    }
    if (ch === '\n' && depth === 0) return null
    if (ch === ';' && depth === 0) return null
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }
    if (IDENT_START.test(ch)) {
      const ident = readIdent(source, i)
      if (ident.value === 'from' && depth === 0) {
        const j = skipTrivia(source, ident.end)
        if (isQuote(source[j])) {
          const spec = readString(source, j)
          return { spec: spec.value, end: spec.end }
        }
      }
      i = ident.end
      continue
    }
    i += 1
  }
  return null
}

function position(source, index) {
  let line = 1
  let last = -1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') {
      line += 1
      last = i
    }
  }
  return { line, column: index - last }
}

function parseCall(source, index, kind) {
  const open = skipTrivia(source, index)
  if (source[open] !== '(') return null
  const arg = skipTrivia(source, open + 1)
  if (source[arg] === ')') return null
  if (source[arg] === "'" || source[arg] === '"') {
    const spec = readString(source, arg)
    return { spec: spec.value, end: spec.end, dynamic: true, kind }
  }
  return { spec: null, dynamic: true, kind, nonliteral: true }
}

export function extractImports(source) {
  const text = String(source)
  const out = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '/') {
      i = skipLineComment(text, i)
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i = skipBlockComment(text, i)
      continue
    }
    if (isQuote(ch)) {
      i = readString(text, i).end
      continue
    }
    if (!IDENT_START.test(ch)) {
      i += 1
      continue
    }
    const start = i
    const ident = readIdent(text, i)
    i = ident.end
    if (text[start - 1] === '.') continue

    if (ident.value === 'import') {
      const next = skipTrivia(text, i)
      if (text[next] === '.') continue
      if (text[next] === '(') {
        const call = parseCall(text, i, 'import')
        if (call) {
          const pos = position(text, start)
          out.push({ ...call, line: pos.line, column: pos.column })
        }
        continue
      }
      if (isQuote(text[next])) {
        const spec = readString(text, next)
        const pos = position(text, start)
        out.push({ spec: spec.value, line: pos.line, column: pos.column, dynamic: false, kind: 'import' })
        i = spec.end
        continue
      }
      const found = findFrom(text, i)
      if (found) {
        const pos = position(text, start)
        out.push({ spec: found.spec, line: pos.line, column: pos.column, dynamic: false, kind: 'import' })
        i = found.end
      }
      continue
    }

    if (ident.value === 'export') {
      const next = skipTrivia(text, i)
      if (text[next] === ':') continue
      const found = findFrom(text, i)
      if (found) {
        const pos = position(text, start)
        out.push({ spec: found.spec, line: pos.line, column: pos.column, dynamic: false, kind: 'export' })
        i = found.end
      }
      continue
    }

    if (ident.value === 'require') {
      const next = skipTrivia(text, i)
      if (text[next] === '.') continue
      if (text[next] === '(') {
        const call = parseCall(text, i, 'require')
        if (call) {
          const pos = position(text, start)
          out.push({ ...call, line: pos.line, column: pos.column })
        }
      }
    }
  }
  return out
}
