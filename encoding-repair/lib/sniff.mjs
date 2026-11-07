// 字节级编码判定。只回答「这是什么编码、能不能安全转成 UTF-8」，不写文件。
const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16LE_BOM = [0xff, 0xfe]
const UTF16BE_BOM = [0xfe, 0xff]
const UTF32LE_BOM = [0xff, 0xfe, 0x00, 0x00]
const UTF32BE_BOM = [0x00, 0x00, 0xfe, 0xff]

const COMMON_HAN = new Set(
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞',
)

function hasBom(buf, bytes) {
  if (buf.length < bytes.length) return false
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[i] !== bytes[i]) return false
  }
  return true
}

function decode(text, label) {
  try {
    return { ok: true, text: new TextDecoder(label, { fatal: true }).decode(text) }
  } catch {
    return { ok: false, text: null }
  }
}

function decodeUtf32(buf, offset, littleEndian) {
  if ((buf.length - offset) % 4 !== 0) return null
  let out = ''
  for (let i = offset; i < buf.length; i += 4) {
    const codePoint = littleEndian ? buf.readUInt32LE(i) : buf.readUInt32BE(i)
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null
    out += String.fromCodePoint(codePoint)
  }
  return out
}

function isHan(codePoint) {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
  )
}

export function scoreText(text) {
  let han = 0
  let common = 0
  let ascii = 0
  let control = 0
  let replacement = 0
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)
    if (isHan(codePoint)) {
      han += 1
      if (COMMON_HAN.has(ch)) common += 1
      continue
    }
    if (codePoint === 0xfffd) {
      replacement += 1
      continue
    }
    if (codePoint < 0x80) {
      if (codePoint >= 0x20 || codePoint === 9 || codePoint === 10 || codePoint === 13) ascii += 1
      else control += 1
      continue
    }
    if (codePoint < 0x20) control += 1
  }
  return {
    han,
    common,
    ascii,
    control,
    replacement,
    score: common * 3 + han * 0.5 + ascii * 0.2 - control * 10 - replacement * 20,
  }
}

function plausible(score) {
  return score.replacement === 0 && score.control <= 1 && (score.han > 0 || score.ascii > 0) && score.score > 0
}

function isBinary(buf) {
  const sample = buf.subarray(0, Math.min(8192, buf.length))
  if (sample.length === 0) return false
  let nul = 0
  let control = 0
  for (const byte of sample) {
    if (byte === 0) nul += 1
    else if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1
  }
  return nul / sample.length > 0.3 || control / sample.length > 0.3
}

function gbkShape(buf) {
  let pairs = 0
  let nonAscii = 0
  for (let i = 0; i < buf.length; ) {
    const b1 = buf[i]
    if (b1 <= 0x7f) {
      i += 1
      continue
    }
    if (b1 < 0x81 || b1 > 0xfe) return null
    const b2 = buf[i + 1]
    if (b2 === undefined) return null
    if (b2 >= 0x30 && b2 <= 0x39) {
      const b3 = buf[i + 2]
      const b4 = buf[i + 3]
      if (b3 >= 0x81 && b3 <= 0xfe && b4 >= 0x30 && b4 <= 0x39) {
        pairs += 1
        nonAscii += 1
        i += 4
        continue
      }
      return null
    }
    if (b2 >= 0x40 && b2 <= 0xfe && b2 !== 0x7f) {
      pairs += 1
      nonAscii += 1
      i += 2
      continue
    }
    return null
  }
  return { pairs, nonAscii }
}

function big5Shape(buf) {
  let pairs = 0
  for (let i = 0; i < buf.length; ) {
    const b1 = buf[i]
    if (b1 <= 0x7f) {
      i += 1
      continue
    }
    if (b1 < 0x81 || b1 > 0xfe) return null
    const b2 = buf[i + 1]
    if (b2 === undefined) return null
    if ((b2 >= 0x40 && b2 <= 0x7e) || (b2 >= 0xa1 && b2 <= 0xfe)) {
      pairs += 1
      i += 2
      continue
    }
    return null
  }
  return { pairs }
}

function zeroParity(buf) {
  const length = Math.min(buf.length - (buf.length % 2), 8192)
  if (length < 2) return null
  let even = 0
  let odd = 0
  for (let i = 0; i < length; i += 2) {
    if (buf[i] === 0) even += 1
    if (buf[i + 1] === 0) odd += 1
  }
  const units = length / 2
  return { even: even / units, odd: odd / units }
}

function tryUtf16NoBom(buf) {
  const parity = zeroParity(buf)
  if (!parity) return null
  const attempts = []
  if (parity.odd >= 0.15 && parity.odd >= parity.even) attempts.push({ littleEndian: true, ratio: parity.odd })
  if (parity.even >= 0.15 && parity.even >= parity.odd) attempts.push({ littleEndian: false, ratio: parity.even })
  for (const attempt of attempts) {
    const decoded = decode(buf, attempt.littleEndian ? 'utf-16le' : 'utf-16be')
    if (!decoded.ok) continue
    if (!plausible(scoreText(decoded.text))) continue
    return {
      encoding: attempt.littleEndian ? 'utf16le' : 'utf16be',
      text: decoded.text,
      confidence: 'medium',
      fixable: true,
      mojibake: false,
      reason: `无 BOM 的 UTF-16${attempt.littleEndian ? 'LE' : 'BE'}（零字节分布 ${(attempt.ratio * 100).toFixed(0)}%）`,
    }
  }
  return null
}

function tryLegacy(buf) {
  const shape = gbkShape(buf)
  if (!shape || shape.pairs < 1 || shape.nonAscii < 2) return null
  const gbk = decode(buf, 'gb18030')
  if (!gbk.ok) return null
  const gbkScore = scoreText(gbk.text)
  if (!plausible(gbkScore) || gbkScore.han < 1) return null

  const big5Valid = big5Shape(buf)
  let big5 = null
  let big5Score = null
  if (big5Valid) {
    big5 = decode(buf, 'big5')
    if (big5.ok) {
      const score = scoreText(big5.text)
      if (plausible(score) && score.han > 0) big5Score = score
    }
  }

  if (big5Score) {
    if (big5Score.score > gbkScore.score * 1.25) {
      return {
        encoding: 'big5',
        text: big5.text,
        confidence: 'medium',
        fixable: false,
        mojibake: false,
        reason: '疑似 Big5（Big5 解码明显更可信）；不自动转换',
      }
    }
    if (gbkScore.score <= big5Score.score * 1.25) {
      return {
        encoding: 'ambiguous',
        text: gbk.text,
        confidence: 'low',
        fixable: false,
        mojibake: false,
        reason: 'GBK 与 Big5 都能解码且得分接近；无法确认，不自动转换',
      }
    }
  }

  return {
    encoding: 'gbk',
    text: gbk.text,
    confidence: big5Score ? 'medium' : 'high',
    fixable: true,
    mojibake: false,
    reason: big5Score ? 'GBK（Big5 也能解，但 GBK 得分更高）' : 'GBK / GB18030',
  }
}

export function sniff(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buf.length === 0) {
    return { encoding: 'utf8', text: '', confidence: 'high', fixable: false, mojibake: false, reason: '空文件' }
  }

  if (hasBom(buf, UTF32LE_BOM) || hasBom(buf, UTF32BE_BOM)) {
    const littleEndian = hasBom(buf, UTF32LE_BOM)
    const text = decodeUtf32(buf, 4, littleEndian)
    if (text === null) {
      return { encoding: 'unknown', text: null, confidence: 'low', fixable: false, mojibake: false, reason: 'UTF-32 BOM 后的字节不合法' }
    }
    return {
      encoding: littleEndian ? 'utf32le' : 'utf32be',
      text,
      confidence: 'high',
      fixable: true,
      mojibake: false,
      reason: `UTF-32${littleEndian ? 'LE' : 'BE'} BOM`,
    }
  }

  if (hasBom(buf, UTF8_BOM)) {
    const decoded = decode(buf.subarray(3), 'utf-8')
    if (!decoded.ok) {
      return { encoding: 'unknown', text: null, confidence: 'low', fixable: false, mojibake: false, reason: 'UTF-8 BOM 后不是合法 UTF-8' }
    }
    return { encoding: 'utf8-bom', text: decoded.text, confidence: 'high', fixable: true, mojibake: false, reason: 'UTF-8 BOM' }
  }

  if (hasBom(buf, UTF16LE_BOM) || hasBom(buf, UTF16BE_BOM)) {
    const littleEndian = hasBom(buf, UTF16LE_BOM)
    const decoded = decode(buf.subarray(2), littleEndian ? 'utf-16le' : 'utf-16be')
    if (!decoded.ok) {
      return { encoding: 'unknown', text: null, confidence: 'low', fixable: false, mojibake: false, reason: 'UTF-16 BOM 后的字节不合法' }
    }
    return {
      encoding: littleEndian ? 'utf16le' : 'utf16be',
      text: decoded.text,
      confidence: 'high',
      fixable: true,
      mojibake: false,
      reason: `UTF-16${littleEndian ? 'LE' : 'BE'} BOM`,
    }
  }

  // UTF-16 的字节里常有 NUL；必须在「合法 UTF-8」之前先看零字节分布，
  // 否则 "h\0e\0l\0l\0o\0" 会被当成含 NUL 的 UTF-8。
  const utf16 = tryUtf16NoBom(buf)
  if (utf16) return utf16

  if (isBinary(buf)) {
    return { encoding: 'binary', text: null, confidence: 'high', fixable: false, mojibake: false, reason: '二进制文件' }
  }

  const utf8 = decode(buf, 'utf-8')
  if (utf8.ok) {
    const mojibake = utf8.text.includes('\ufffd') || utf8.text.includes('锟斤拷') || utf8.text.includes('ï¿½')
    if (mojibake) {
      return {
        encoding: 'utf8',
        text: utf8.text,
        confidence: 'high',
        fixable: false,
        mojibake: true,
        reason: '已是 UTF-8，但含 U+FFFD / 锟斤拷 / ï¿½ 二次转码痕迹；只报告，不自动改',
      }
    }
    return { encoding: 'utf8', text: utf8.text, confidence: 'high', fixable: false, mojibake: false, reason: 'UTF-8' }
  }

  const legacy = tryLegacy(buf)
  if (legacy) return legacy

  return {
    encoding: 'unknown',
    text: null,
    confidence: 'low',
    fixable: false,
    mojibake: false,
    reason: '不是合法 UTF-8 / UTF-16 / GBK，未识别编码',
  }
}
