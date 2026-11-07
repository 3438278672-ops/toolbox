// 只解析 cordis 补丁真正用到的 YAML 子集：顶层 `- insert:`、条目 id/name/config、
// flow 的 {} / []、!!js 前缀。解析不了就带行号失败，绝不猜。
export class PatchParseError extends Error {
  constructor(message, line) {
    super(message)
    this.name = 'PatchParseError'
    this.line = line ?? null
  }
}

function tokenize(text) {
  const out = []
  String(text).split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1
    const leading = /^[ \t]*/.exec(raw)[0]
    if (leading.includes('\t')) throw new PatchParseError('缩进里有 tab，YAML 只允许空格', line)
    const content = raw.replace(/\s+$/, '')
    const trimmed = content.trimStart()
    if (!trimmed || trimmed.startsWith('#')) return
    out.push({ indent: content.length - trimmed.length, content: trimmed, line })
  })
  return out
}

function stripComment(text) {
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd()
    }
  }
  return text
}

function parseString(text, line) {
  const quote = text[0]
  let out = ''
  let i = 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && quote === '"' && i + 1 < text.length) {
      const next = text[i + 1]
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next
      i += 2
      continue
    }
    if (ch === quote) {
      if (quote === "'" && text[i + 1] === "'") {
        out += "'"
        i += 2
        continue
      }
      return { value: out, end: i + 1 }
    }
    out += ch
    i++
  }
  throw new PatchParseError('字符串没有闭合', line)
}

function parseFlow(text, line) {
  let i = 0
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const fail = (message) => {
    throw new PatchParseError(message, line)
  }
  const bare = (stops) => {
    const start = i
    while (i < text.length && !stops.includes(text[i])) i++
    return text.slice(start, i).trim()
  }

  function value() {
    skip()
    if (i >= text.length) fail('flow 值意外结束')
    if (text[i] === '{') {
      i++
      const obj = {}
      skip()
      if (text[i] === '}') {
        i++
        return obj
      }
      for (;;) {
        skip()
        let key
        if (text[i] === '"' || text[i] === "'") {
          const parsed = parseString(text.slice(i), line)
          key = parsed.value
          i += parsed.end
        } else {
          key = bare(':,}')
        }
        skip()
        if (text[i] !== ':') fail(`flow map 的键 "${key}" 后缺少冒号`)
        i++
        obj[key] = value()
        skip()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') {
          i++
          return obj
        }
        fail('flow map 没有闭合')
      }
    }
    if (text[i] === '[') {
      i++
      const arr = []
      skip()
      if (text[i] === ']') {
        i++
        return arr
      }
      for (;;) {
        arr.push(value())
        skip()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') {
          i++
          return arr
        }
        fail('flow 列表没有闭合')
      }
    }
    if (text[i] === '"' || text[i] === "'") {
      const parsed = parseString(text.slice(i), line)
      i += parsed.end
      return parsed.value
    }
    return bare(',]}')
  }

  const result = value()
  skip()
  if (i < text.length) fail('flow 值后面还有多余字符')
  return result
}

function parseScalar(raw, line) {
  let text = stripComment(raw).trim()
  if (!text) return null
  if (text.startsWith('!!js')) {
    text = text.slice(4).trim()
    if (!text) throw new PatchParseError('!!js 后面没有值', line)
  }
  if (text.startsWith('{') || text.startsWith('[')) return parseFlow(text, line)
  if (text.startsWith('"') || text.startsWith("'")) {
    const parsed = parseString(text, line)
    if (parsed.end !== text.length) throw new PatchParseError('字符串后面还有多余字符', line)
    return parsed.value
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (/^[|>]/.test(text)) throw new PatchParseError('不支持块标量（| / >）', line)
  return text
}

function splitKey(content, line) {
  let quote = null
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (quote) {
      if (ch === quote && content[i - 1] !== '\\') quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ':') {
      const key = content.slice(0, i).trim()
      if (!key) throw new PatchParseError('键名为空', line)
      return { key, rest: content.slice(i + 1).trim() }
    }
  }
  throw new PatchParseError(`这一行不是 key: value（${content}）`, line)
}

function attachLine(obj, line) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    Object.defineProperty(obj, '__line', { value: line, enumerable: false })
  }
  return obj
}

function parseMap(lines, index, indent, nestedFloor = indent) {
  const obj = {}
  let i = index
  while (i < lines.length && lines[i].indent === indent && !lines[i].content.startsWith('-')) {
    const line = lines[i]
    const { key, rest } = splitKey(line.content, line.line)
    i++
    if (rest !== '') {
      obj[key] = parseScalar(rest, line.line)
    } else if (i < lines.length && lines[i].indent > nestedFloor) {
      const nested = parseBlock(lines, i, lines[i].indent)
      obj[key] = nested.value
      i = nested.next
    } else {
      obj[key] = null
    }
  }
  return { value: obj, next: i }
}

function parseSeq(lines, index, indent) {
  const items = []
  let i = index
  while (i < lines.length && lines[i].indent === indent && lines[i].content.startsWith('-')) {
    const line = lines[i]
    const rest = line.content.slice(1).trim()
    if (!rest) {
      i++
      if (i < lines.length && lines[i].indent > indent) {
        const nested = parseBlock(lines, i, lines[i].indent)
        items.push(nested.value)
        i = nested.next
      } else {
        items.push(null)
      }
      continue
    }
    if (!/^["'[{]/.test(rest) && /^[^:]+:/.test(rest)) {
      // `- id: x` 是 map 条目：把这一行当成缩进 +2 的第一行，再吃掉后续缩进更深的行。
      const first = { indent: indent + 2, content: rest, line: line.line }
      const sub = [first]
      i++
      while (i < lines.length && lines[i].indent > indent) {
        sub.push(lines[i])
        i++
      }
      const parsed = parseMap(sub, 0, indent + 2, indent)
      if (parsed.next < sub.length) {
        throw new PatchParseError('map 条目里有多余的缩进', sub[parsed.next].line)
      }
      items.push(attachLine(parsed.value, line.line))
      continue
    }
    items.push(parseScalar(rest, line.line))
    i++
  }
  return { value: items, next: i }
}

function parseBlock(lines, index, indent) {
  return lines[index].content.startsWith('-')
    ? parseSeq(lines, index, indent)
    : parseMap(lines, index, indent)
}

export function parsePatchYaml(text) {
  try {
    const lines = tokenize(text)
    if (lines.length === 0) throw new PatchParseError('补丁文件为空', 1)
    const root = parseBlock(lines, 0, lines[0].indent)
    if (root.next < lines.length) {
      throw new PatchParseError('缩进不一致，无法判断这一行属于哪里', lines[root.next].line)
    }
    if (!Array.isArray(root.value)) throw new PatchParseError('补丁顶层必须是列表', lines[0].line)

    const entries = []
    let sawInsert = false
    for (const item of root.value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PatchParseError('顶层列表的每一项都必须是 map', lines[0].line)
      }
      if (!('insert' in item)) continue
      sawInsert = true
      if (!Array.isArray(item.insert)) {
        throw new PatchParseError('insert 必须是列表', item.__line ?? lines[0].line)
      }
      for (const entry of item.insert) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new PatchParseError('insert 里的每一项都必须是 map', item.__line ?? lines[0].line)
        }
        entries.push({
          id: typeof entry.id === 'string' ? entry.id : null,
          name: typeof entry.name === 'string' ? entry.name : null,
          line: Number.isInteger(entry.__line) ? entry.__line : null,
        })
      }
    }
    if (!sawInsert) throw new PatchParseError('补丁里没有 insert 段', lines[0].line)
    return { ok: true, entries, error: null, line: null }
  } catch (err) {
    if (err instanceof PatchParseError) {
      return { ok: false, entries: [], error: err.message, line: err.line }
    }
    return { ok: false, entries: [], error: err.message, line: null }
  }
}
