import { lineAt, textRule } from './util.mjs'

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16_LE = [0xff, 0xfe]
const UTF16_BE = [0xfe, 0xff]
const UTF32_LE = [0xff, 0xfe, 0x00, 0x00]
const UTF32_BE = [0x00, 0x00, 0xfe, 0xff]
const MOJIBAKE = ['\uFFFD', '锟斤拷', 'ï¿½']
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function startsWith(buf, bytes) {
  if (buf.length < bytes.length) return false
  for (let i = 0; i < bytes.length; i += 1) if (buf[i] !== bytes[i]) return false
  return true
}

function bomKind(buf) {
  if (startsWith(buf, UTF32_LE)) return 'UTF-32 LE'
  if (startsWith(buf, UTF32_BE)) return 'UTF-32 BE'
  if (startsWith(buf, UTF8_BOM)) return 'UTF-8'
  if (startsWith(buf, UTF16_LE)) return 'UTF-16 LE'
  if (startsWith(buf, UTF16_BE)) return 'UTF-16 BE'
  return null
}

function bytesOf(ctx, file) {
  return ctx.readBytes(file.rel)
}

export const ENCODING_RULES = [
  textRule({
    id: 'ENC001',
    category: 'encoding',
    checklist: 'encoding',
    severity: 'error',
    async run(ctx, file) {
      const buf = await bytesOf(ctx, file)
      if (buf.length === 0) return null
      const kind = bomKind(buf)
      if (kind && kind !== 'UTF-8') return null
      try {
        strictUtf8.decode(buf)
        return null
      } catch {
        const lenient = buf.toString('utf8')
        const index = lenient.indexOf('\uFFFD')
        return {
          file: file.rel,
          line: index >= 0 ? lineAt(lenient, index) : null,
          message: '文件不是合法 UTF-8（疑似 GBK/ANSI 写出）',
          hint: '用编码修复把它转成 UTF-8；之后让编辑器固定以 UTF-8 保存。',
        }
      }
    },
  }),

  textRule({
    id: 'ENC002',
    category: 'encoding',
    checklist: 'encoding',
    severity: 'warn',
    async run(ctx, file) {
      const kind = bomKind(await bytesOf(ctx, file))
      if (kind !== 'UTF-8') return null
      return {
        file: file.rel,
        line: 1,
        message: '文件带 UTF-8 BOM',
        hint: '另存为 UTF-8（无 BOM）；BOM 会让 shebang 和部分解析器出错。',
      }
    },
  }),

  textRule({
    id: 'ENC003',
    category: 'encoding',
    checklist: 'encoding',
    severity: 'error',
    async run(ctx, file) {
      const kind = bomKind(await bytesOf(ctx, file))
      if (!kind || kind === 'UTF-8') return null
      return {
        file: file.rel,
        line: 1,
        message: `文件是 ${kind} 编码，DSH 会按 UTF-8 读`,
        hint: '另存为 UTF-8（无 BOM）。',
      }
    },
  }),

  textRule({
    id: 'ENC004',
    category: 'encoding',
    checklist: 'encoding',
    severity: 'warn',
    async run(ctx, file, source) {
      const buf = await bytesOf(ctx, file)
      const kind = bomKind(buf)
      if (kind && kind !== 'UTF-8') return null
      try {
        strictUtf8.decode(buf)
      } catch {
        return null
      }
      let best = null
      for (const marker of MOJIBAKE) {
        const index = source.indexOf(marker)
        if (index >= 0 && (!best || index < best.index)) best = { index, marker }
      }
      if (!best) return null
      return {
        file: file.rel,
        line: lineAt(source, best.index),
        message: `文本里出现乱码标记 ${JSON.stringify(best.marker)}`,
        hint: '从原始来源重新复制这段文字，或按实际编码重新保存。',
      }
    },
  }),

  textRule({
    id: 'ENC005',
    category: 'encoding',
    checklist: 'encoding',
    severity: 'warn',
    run(_ctx, file, source) {
      if (!source.startsWith('#!')) return null
      if (!/\r\n/.test(source)) return null
      return {
        file: file.rel,
        line: 1,
        message: '带 shebang 的文件使用 CRLF 换行',
        hint: '转成 LF；Windows 上可用 .gitattributes 固定 eol=lf。',
      }
    },
  }),
]
