// 引擎：一个包只在这里被读一次，规则只拿到 PackageContext。
import fsp from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { readManifest } from './manifest.mjs'
import { parsePatchYaml } from './patch.mjs'
import { walkPackage } from './walk.mjs'
import { buildReport, verdictOf } from './report.mjs'
import { RULES, RULE_BY_ID, PACKAGE_RULES, TEXT_RULES } from './rules/index.mjs'
import { buildChecklist, countSeverities, severityFor } from './rules/util.mjs'

const KNOWN_RULE_IDS = RULES.map((rule) => rule.id)

function asArray(value) {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function normalizeFinding(rule, scope, raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  return {
    rule: rule.id,
    category: rule.category,
    severity: severityFor(rule, scope),
    scope,
    file: typeof item.file === 'string' ? item.file : null,
    line: Number.isInteger(item.line) ? item.line : null,
    column: Number.isInteger(item.column) ? item.column : null,
    message: String(item.message ?? ''),
    hint: String(item.hint ?? ''),
    snippet: typeof item.snippet === 'string' ? item.snippet : null,
  }
}

export function createContext({ dir, walk, manifest, manifestError, patch, config }) {
  const sources = new Map()
  const buffers = new Map()
  const readErrors = [...(walk.readErrors ?? [])]

  async function readBytes(rel) {
    if (buffers.has(rel)) return buffers.get(rel)
    const abs = path.join(dir, ...String(rel).split('/'))
    const buffer = await fsp.readFile(abs)
    buffers.set(rel, buffer)
    return buffer
  }

  async function read(rel) {
    if (sources.has(rel)) return sources.get(rel)
    const buffer = await readBytes(rel)
    const text = buffer.toString('utf8')
    sources.set(rel, text)
    return text
  }

  return {
    dir,
    name: manifest?.name ?? path.basename(dir),
    version: manifest?.version ?? null,
    manifest,
    manifestError,
    patch,
    config,
    ...walk,
    readErrors,
    sources,
    findings: [],
    read,
    readBytes,
  }
}

export function applyWaivers(findings, waivers) {
  const used = waivers.map(() => 0)
  const kept = []
  const waived = []
  for (const item of findings) {
    const index = waivers.findIndex(
      (waiver) => waiver.file === item.file && waiver.rules.includes(item.rule),
    )
    if (index >= 0) {
      used[index] += 1
      waived.push(item)
    } else {
      kept.push(item)
    }
  }
  return { kept, waived, used }
}

function isDisabled(config, id) {
  return config.rules[id] === 'off'
}

export async function analyzePackage(dir, options = {}) {
  const resolved = path.resolve(dir)
  const { config, issues } = await loadConfig(resolved, { knownRuleIds: KNOWN_RULE_IDS })
  const walked = await walkPackage(resolved, { ignore: config.ignore, limits: config.limits })
  const { manifest, error: manifestError } = await readManifest(resolved)

  let patch = null
  const patchRel = manifest?.dsh?.bundle?.patch
  if (typeof patchRel === 'string' && patchRel.trim() !== '') {
    const rel = patchRel.replace(/^\.\//, '').replace(/\\/g, '/')
    try {
      const text = await fsp.readFile(path.join(resolved, ...rel.split('/')), 'utf8')
      patch = { ...parsePatchYaml(text), rel }
    } catch (err) {
      patch = {
        ok: false,
        entries: [],
        error: `补丁文件读取失败：${err.message}`,
        line: null,
        rel,
      }
    }
  }

  const ctx = createContext({
    dir: resolved,
    walk: walked,
    manifest,
    manifestError,
    patch,
    config,
  })
  const disabled = new Set(Object.entries(config.rules).filter(([, level]) => level === 'off').map(([id]) => id))
  const onlyRules = options.onlyRules ? new Set(options.onlyRules) : null
  const canRun = (id) => !isDisabled(config, id) && (!onlyRules || onlyRules.has(id))

  const push = (rule, scope, raw) => {
    const item = normalizeFinding(rule, scope, raw)
    ctx.findings.push(item)
    return item
  }
  const meta = (id, fields) => {
    if (!canRun(id)) return null
    const rule = RULE_BY_ID.get(id)
    return push(rule, 'package', fields)
  }

  for (const item of issues) {
    if (!canRun(item.rule)) continue
    const rule = RULE_BY_ID.get(item.rule)
    if (!rule) continue
    push(rule, 'package', {
      file: item.file,
      line: item.line,
      message: item.message,
      hint: item.hint,
    })
  }

  if (walked.largeSkipped.length > 0) {
    const first = walked.largeSkipped.slice(0, 3).join('、')
    const more = walked.largeSkipped.length > 3 ? ` 等 ${walked.largeSkipped.length} 个` : ''
    meta('WALK001', {
      message: `有 ${walked.largeSkipped.length} 个文件超过 maxFileBytes，内容未扫描：${first}${more}`,
      hint: '调大 limits.maxFileBytes，或把构建产物/缓存排除出发布集合；超大文件本身也不该进仓库。',
    })
  }

  if (walked.truncated) {
    meta('WALK002', {
      message: `文件数达到 maxFiles（${config.limits.maxFiles}），扫描提前停止`,
      hint: '调大 limits.maxFiles，或把构建产物/缓存目录加入 .gitignore。',
    })
  }

  const seenReadErrors = new Set()
  const reportReadError = (rel, message) => {
    if (seenReadErrors.has(rel)) return
    seenReadErrors.add(rel)
    meta('WALK004', {
      file: rel,
      message: `读取文件失败：${message}`,
      hint: '检查文件权限；该文件的内容检查被跳过，结论没有覆盖它。',
    })
  }
  for (const item of walked.readErrors) reportReadError(item.rel, item.message)

  for (const rule of PACKAGE_RULES) {
    if (!canRun(rule.id)) continue
    const out = await rule.run(ctx)
    for (const raw of asArray(out)) push(rule, 'package', raw)
  }

  const files = [...ctx.files].sort((a, b) => a.rel.localeCompare(b.rel, 'en'))
  for (const file of files) {
    if (file.kind !== 'text') continue
    let source
    try {
      source = await ctx.read(file.rel)
    } catch (err) {
      reportReadError(file.rel, err.message)
      continue
    }
    for (const rule of TEXT_RULES) {
      if (!canRun(rule.id)) continue
      const out = await rule.run(ctx, file, source)
      for (const raw of asArray(out)) push(rule, file.scope, raw)
    }
  }

  const { kept, waived, used } = applyWaivers(ctx.findings, config.waivers)
  const full = [...kept]
  config.waivers.forEach((waiver, index) => {
    if (used[index] > 0) return
    const item = meta('CFG004', {
      file: '.pluginlint.json',
      message: `waiver 未命中任何 finding：${waiver.file}（${waiver.rules.join(', ')}）`,
      hint: '删掉这条 waiver，或检查路径是否写成相对包根、用 "/" 分隔。',
    })
    if (item) full.push(item)
  })

  const limit = config.limits.maxFindings
  let truncated = false
  if (full.length > limit) {
    truncated = true
    const walk003 = meta('WALK003', {
      message: `findings 共 ${full.length} 条，超过 maxFindings（${limit}），报告只展示前 ${limit} 条；判定仍按全量。`,
      hint: '调大 limits.maxFindings，或先修掉高频问题再看。',
    })
    if (walk003) full.push(walk003)
  }

  const counts = countSeverities(full)
  const failOn = options.failOn ?? config.failOn
  const verdict = verdictOf(full, failOn)
  let shown = truncated ? full.slice(0, limit) : full
  if (truncated && !shown.some((item) => item.rule === 'WALK003')) {
    const walk003 = full.find((item) => item.rule === 'WALK003')
    if (walk003) shown = [...shown, walk003]
  }

  return {
    dir: resolved,
    name: ctx.name,
    version: ctx.version,
    verdict,
    counts,
    waived: waived.length,
    truncated,
    files: walked.stats,
    checklist: buildChecklist(full, { syntaxCheck: config.syntaxCheck }),
    findings: shown,
    disabledRules: [...disabled].sort(),
  }
}

export async function lint(request = {}) {
  const { dirs, root, now = new Date(), failOn } = request
  if (dirs && root) throw new Error('dirs 与 root 只能给一个')
  if (!Array.isArray(dirs) || dirs.length === 0) {
    throw new Error('还没有给扫描目录：传 dirs（指定目录）或 root（工作区发现）')
  }
  const packages = []
  for (const dir of dirs) {
    packages.push(await analyzePackage(path.resolve(dir), { failOn }))
  }
  return buildReport({ packages, topFindings: [], now, failOn })
}
