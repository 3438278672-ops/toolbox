# dsh-plugin-lint 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-11-08-dsh-plugin-lint-design.md` 实现零依赖的 DSH 插件发布前自检器：DSH 工具 `plugin_lint` + CLI `plugin-lint`，输出「可发/不可发」的 Markdown 检查单与稳定 JSON。

**Architecture:** 四层：walker（gitignore 语义的文件集合）→ 元数据解析（package.json / cordis.patch.yml / .pluginlint.json）→ 规则注册表（纯函数，只吃 `PackageContext`）→ 报告（verdict / Markdown / JSON）。工具与 CLI 是同一 `lib/engine.mjs` 的两个薄壳。

**Tech Stack:** Node ≥ 20，ESM，仅 `node:` 内置模块，`node:test`。

## Global Constraints

- **零运行时依赖**：不得出现 `dependencies`；只用 `fs`/`path`/`module`/`url`/`child_process`/`buffer`。
- **只读被扫目录**：唯一写盘是调用方显式给的 `out` 目录。
- **相对路径一律用 `/`**；拼绝对路径用 `path.join`/`path.resolve`。
- **源码必须 UTF-8 无 BOM、LF**；文件末尾一个换行。
- **不提交测试 fixture**：所有坏文件由测试运行时写 `os.tmpdir()`。
- **规则不读盘**：规则只接收 `PackageContext`；需要文本时用 `await ctx.read(rel)`（带缓存）。违者视为实现错误。
- **自检必须过**：`node bin/plugin-lint.mjs .` 输出 `publishable` 且 0 error。
- 本机跑测试若 `node --test test/` 报 `spawn EPERM`，改为逐个 `node test/xxx.test.mjs`（已知沙箱限制）。
- 每次改 `.js`/`.json` 用 write/edit，不用 PowerShell `Set-Content`（会按 GBK 写坏中文）。

---

## 文件结构（最终形态）

```
toolbox/                              # GitHub 仓库根（3438278672-ops/toolbox）
  README.md                           # 两个插件索引
  .gitignore
  plugin-lint/                        # 本计划交付物
    package.json
    cordis.patch.yml
    index.js                          # DSH 工具壳
    bin/plugin-lint.mjs               # CLI 入口（只解析 argv + process.exit）
    lib/
      engine.mjs                      # analyzePackage / lint / createContext
      walk.mjs                        # 三集合遍历 + 文件分类 + scope
      gitignore.mjs                   # .gitignore 子集 → matcher
      manifest.mjs                    # package.json 读取 + exports/files 解析
      patch.mjs                       # cordis.patch.yml 子集解析
      config.mjs                      # .pluginlint.json 校验与合并
      discover.mjs                    # 工作区候选发现
      imports.mjs                     # import/require 静态抽取
      report.mjs                      # verdict / checklist / Markdown / JSON
      cli.mjs                         # runCli(argv, io)
      rules/
        index.mjs                     # 注册表
        util.mjs                      # rule 构造器 / finding 形状 / 规则公共工具
        patterns.mjs                  # 所有正则模式表（唯一豁免文件）
        meta.mjs                      # WALK001-004, CFG001-004, DISCOVER001 元数据
        manifest.mjs                  # PKG001-013
        patch.mjs                     # PATCH001-005
        paths.mjs                     # PAT001
        encoding.mjs                  # ENC001-005
        deps.mjs                      # DEP001-006
        secrets.mjs                   # SEC001-003
        repo.mjs                      # REPO001-005
        display.mjs                   # DOC001-002, DSP001-005
        syntax.mjs                    # SYN001-002
    locale/zh.json
    locale/en.json
    icon.svg
    README.md
    LICENSE
    .gitignore
    .pluginlint.json                  # 只放 patterns.mjs 的显式 waiver
    docs/superpowers/specs/2026-11-08-dsh-plugin-lint-design.md
    docs/superpowers/plans/2026-11-08-dsh-plugin-lint-implementation.md
    test/
      helpers.mjs
      gitignore.test.mjs
      walk.test.mjs
      manifest.test.mjs
      patch.test.mjs
      config.test.mjs
      imports.test.mjs
      rules-manifest.test.mjs
      rules-paths-encoding.test.mjs
      rules-deps.test.mjs
      rules-secrets-repo.test.mjs
      rules-display-syntax.test.mjs
      engine.test.mjs
      cli.test.mjs
      discover.test.mjs
  encoding-repair/                    # 后续计划，不在本计划范围
```

---

## 契约（所有任务共享，先定死）

### Finding（规则返回的**局部**形状）

规则不填 `rule/severity/scope/category/checklist`，由引擎补：

```js
{
  file: "lib/x.mjs" | null,     // 包根相对，'/'
  line: 12 | null,
  column: 3 | null,
  message: "一句问题",
  hint: "具体修法，不许空话",
  snippet: "打码后的片段" | null,
}
```

引擎产出的完整 Finding：

```js
{ rule, category, severity: "error"|"warn"|"info", scope: "runtime"|"test"|"docs"|"package",
  file, line, column, message, hint, snippet }
```

### 规则定义

```js
// lib/rules/util.mjs
export const CHECKLISTS = ["manifest","patch","paths","encoding","deps","secrets","repo","display","syntax","config"]

export function packageRule({ id, category, severity, run })   // kind: "package"
export function textRule({ id, category, severity, run })      // kind: "text"，run(ctx, file, source)
export function metaRule({ id, category, severity })           // kind: "meta"，只提供元数据，不执行
export function severityFor(rule, scope)                        // string | {runtime,test,docs,package}
export function finding(fields)                                 // 直接返回 fields
```

`severity` 可为 `"error"`，也可为 `{ runtime:"error", test:"warn", docs:"info" }`；缺省 scope 回退 runtime，再缺省 `"warn"`。

### PackageContext

```js
{
  dir, name, version,
  manifest,            // object | null
  manifestError,       // string | null
  patch,               // { ok, entries, error, line } | null
  config,              // 合并默认值后的配置
  files,               // published: [{ rel, abs, size, kind:"text"|"binary"|"large", scope }]
  ignoredFiles,        // [{ rel, size, kind, rule }]
  prunedDirs,          // [{ rel, reason:"vendor"|"gitignore", ignored }]
  stats,               // { published, ignored, pruned, binary, text, large }
  sources,             // Map<rel, string>
  async read(rel),     // 读文本（缓存），失败抛错
  findings,            // 引擎累计
}
```

### 公开接口

```js
// lib/walk.mjs
export const PRUNE_DIRS
export const DEFAULT_LIMITS
export function scopeOf(rel)                       // "test"|"docs"|"runtime"
export async function classifyFile(abs, size, maxFileBytes)
export async function walkPackage(dir, { ignore = [], limits = DEFAULT_LIMITS } = {})

// lib/gitignore.mjs
export function parseGitignore(text)               // { match(rel, isDir) -> { ignored, rule } }
export function combineMatchers(matchers)          // 后匹配覆盖前匹配

// lib/manifest.mjs
export async function readManifest(dir)            // { manifest, error }
export function exportTargets(manifest)            // [{ subpath, target, pattern }]
export function filesMatcher(manifest)             // (rel) -> boolean（files 缺省视为全包含）

// lib/patch.mjs
export function parsePatchYaml(text)               // { ok, entries:[{id,name,line}], error, line }

// lib/config.mjs
export const DEFAULT_CONFIG
export async function loadConfig(dir, { knownRuleIds }) // { config, issues }
export function normalizeConfig(raw, { knownRuleIds, atPackageLevel })

// lib/discover.mjs
export async function discoverPackages(root, { depth = 3 } = {})  // { packages: string[], scanned }

// lib/engine.mjs
export async function analyzePackage(dir, opts)    // PackageReport
export async function lint(request)                // Report
export function createContext(...)                 // 测试可单独用

// lib/report.mjs
export function buildReport({ packages, topFindings, now, tool, limit })
export function renderMarkdown(report, { limit = 12 } = {})
export function verdictOf(findings, failOn)

// lib/cli.mjs
export async function runCli(argv, io)             // io = { cwd, stdout, stderr, env }
```

`lint(request)`：`{ dirs, root, depth, syntax, failOn, limit, now }`；`dirs` 与 `root` 互斥（都给时报错返回）。

---

## Task 0：仓库落位

**Files:**
- Create: `D:\新建文件夹\DSK\toolbox\README.md`, `D:\新建文件夹\DSK\toolbox\.gitignore`
- Move: `D:\新建文件夹\DSK\dsh-plugin-lint` → `D:\新建文件夹\DSK\toolbox\plugin-lint`

**Steps:**

- [ ] 确认目标不存在：`Test-Path 'D:\新建文件夹\DSK\toolbox\plugin-lint'` 必须为 `False`；`D:\新建文件夹\DSK\dsh-plugin-lint` 存在。
- [ ] `New-Item -ItemType Directory 'D:\新建文件夹\DSK\toolbox'`，`Move-Item 'D:\新建文件夹\DSK\dsh-plugin-lint' 'D:\新建文件夹\DSK\toolbox\plugin-lint'`。
- [ ] 写 `toolbox/.gitignore`：`node_modules/`、`*.log`、`.DS_Store`、`Thumbs.db`。
- [ ] 写 `toolbox/README.md`：一句话仓库定位 + 两个插件目录的占位（`plugin-lint` 已就绪，`encoding-repair` 待加）。
- [ ] `git init -b main`；仓库级 `git config user.name "3438278672-ops"`、`git config user.email "3438278672-ops@users.noreply.github.com"`；`git remote add origin git@github.com:3438278672-ops/toolbox.git`。
- [ ] `git add -A && git commit -m "chore: scaffold toolbox with plugin-lint design"`。

**Verify:** `git -C 'D:\新建文件夹\DSK\toolbox' status --short` 为空；`git remote -v` 指向 SSH。

---

## Task 1：包骨架 + gitignore + walker

**Files:**
- Create: `plugin-lint/package.json`, `plugin-lint/cordis.patch.yml`, `plugin-lint/.gitignore`, `plugin-lint/LICENSE`, `plugin-lint/icon.svg`
- Create: `plugin-lint/lib/gitignore.mjs`, `plugin-lint/lib/walk.mjs`
- Create: `plugin-lint/test/helpers.mjs`, `plugin-lint/test/gitignore.test.mjs`, `plugin-lint/test/walk.test.mjs`

**Interfaces（本任务产出）:**

```js
// gitignore
parseGitignore(text) -> { match(rel, isDir) -> { ignored:boolean, rule:string|null } }
combineMatchers(matchers) -> { match(rel, isDir) }

// walk
PRUNE_DIRS = new Set(["node_modules",".git",".hg",".svn",".venv","__pycache__",".cache",".DS_Store"])
DEFAULT_LIMITS = { maxFileBytes: 4194304, maxFiles: 20000 }
scopeOf(rel) -> "test"|"docs"|"runtime"
classifyFile(abs, size, maxFileBytes) -> { kind:"text"|"binary"|"large", size }
walkPackage(dir, { ignore, limits }) -> {
  files, ignoredFiles, prunedDirs,
  stats: { published, ignored, pruned, binary, text, large },
  largeSkipped: string[], truncated: boolean
}
```

**Implementation notes:**

- `parseGitignore`：逐行；空行/`#` 跳过；`!` 取反；结尾 `/` 仅目录；开头 `/` 锚根；含中间 `/` 锚根；`*` 不跨 `/`，`**` 跨目录，`?`、`[...]`；后匹配覆盖前匹配。规则编译成正则，返回命中的原始 pattern。
- `walkPackage`：从包根递归；每层读该目录的 `.gitignore`，压入 matcher 栈（深层后匹配）；命中固定裁剪表 → 记 `prunedDirs`，`ignored` 由 matcher 决定，不进入；命中 matcher 的目录 → `prunedDirs{reason:"gitignore",ignored:true}`，不进入；文件命中 → `ignoredFiles`，不进 `published`。`config.ignore` 作为根级额外 matcher（`ignore` 数组按 glob 转 pattern，只支持 `*`/`**`）。
- 目录与文件列表排序（`rel.localeCompare`）保证输出稳定。
- `classifyFile`：`size > maxFileBytes` → `large`，不读；否则读前 8192 字节：UTF-16/32 BOM 视为 `text`（交给 ENC003 报）；含 NUL → `binary`；其余 `text`。
- `maxFiles`：达到上限停止深入，`truncated:true`，已收集的保留。

**package.json 内容（定稿）：**

```json
{
  "name": "dsh-plugin-lint",
  "version": "0.1.0",
  "type": "module",
  "description": "DSH 插件发布前自检：绝对路径、编码、清单、依赖与发布卫生",
  "license": "MIT",
  "bin": { "plugin-lint": "./bin/plugin-lint.mjs" },
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json",
    "./icon.svg": "./icon.svg",
    "./locale/*.json": "./locale/*.json"
  },
  "files": [
    "index.js", "bin", "lib", "cordis.patch.yml", "icon.svg", "locale",
    "README.md", "LICENSE"
  ],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test test/" }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: plugin-lint
      name: dsh-plugin-lint
      config: {}
```

**Tests:**

- `gitignore.test.mjs`：`*.log` 命中 `a.log` 不命中 `a.txt`；`/build/` 只命中根 `build/`；`docs/**/*.md` 跨层；`!keep.md` 覆盖前面的 `*.md`；`node_modules/` 目录；被忽略目录里的 `!` 不救回（用 walker 测）。
- `walk.test.mjs`：临时树 `src/a.mjs`、`credential.json`、`.gitignore` 含 `credential.json`、`node_modules/x/index.js`（未忽略）、`dist/`（忽略）、`docs/guide.md`、UTF-16 文件、二进制文件、5 MiB 文件（用 `maxFileBytes` 调小到 1 KiB）；断言三集合、`node_modules` 在 `prunedDirs` 且 `ignored:false`、`dist` 在 `prunedDirs` 且 `ignored:true`、UTF-16 是 `text`、二进制是 `binary`、大文件是 `large` 且 `largeSkipped` 含它；`scopeOf` 表。
- helpers：`makeTree(t, files)` 写临时目录并 `t.after(rm)`；`winPath(...parts)` 运行时拼 `C:\...`，源码不出现完整绝对路径。

**Verify:** `node test/gitignore.test.mjs`、`node test/walk.test.mjs` 全绿。

---

## Task 2：清单 / 补丁 / 配置解析

**Files:**
- Create: `plugin-lint/lib/manifest.mjs`, `plugin-lint/lib/patch.mjs`, `plugin-lint/lib/config.mjs`
- Create: `plugin-lint/test/manifest.test.mjs`, `plugin-lint/test/patch.test.mjs`, `plugin-lint/test/config.test.mjs`

**Interfaces:**

- `readManifest(dir)`：读 `package.json`；不存在/JSON 非法 → `{manifest:null, error}`；否则 `{manifest, error:null}`。
- `exportTargets(manifest)`：把 `exports` 展开成 `[{subpath, target, pattern}]`；字符串 exports 等价于 `"."`；对象按 key；数组取每项；`main` 在没有 exports 时作为 `"."`。`pattern` 为含 `*` 的目标。
- `filesMatcher(manifest)`：`files` 缺失 → `() => true`；否则把每项转 glob（`*` 不跨 `/`，`**` 跨）匹配。
- `parsePatchYaml(text)`：只支持 DSH 方言——顶层 `- insert:`，其下 `- id: x` / `name: y` / `config: {}`（或空）、注释、flow `{}`/`[]`、标量、`!!js` 前缀忽略。返回 `{ok, entries, error, line}`；tab 缩进或结构非法 → `ok:false` 并给行号。
- `DEFAULT_CONFIG`：按设计 §4.7 的 `limits` 与 `syntaxCheck:true`、`failOn:"error"`、`discovery.depth:3`、`ignore:[]`、`rules:{}`、`waivers:[]`。
- `normalizeConfig(raw, {knownRuleIds, atPackageLevel})` → `{config, issues}`；issues 是 `{ruleId, file, line, message, hint}`：非法 JSON 由 `loadConfig` 产生 CFG001；未知顶层字段 CFG002；未知规则 id / 非法级别 CFG003；waiver 缺 `file`/`rules`/`reason`、未命中、包级 `discovery` → CFG004（未命中在引擎里补）。`rules` 里的合法值只认 `off|info|warn|error`。
- `loadConfig(dir, {knownRuleIds})`：读 `.pluginlint.json`；不存在 → 默认配置、无 issue；解析失败 → CFG001 issue + 默认配置。

**Tests:**

- manifest：真实 `dsh-opcg-cards` 风格清单可解析；`exports` 字符串/对象/数组/`*`；`main` 兜底；`files` 缺失返回全包含；`files` 通配匹配。
- patch：解析 `D:\OPCG\plugins\dsh-opcg-cards\cordis.patch.yml` 的真实内容（fixture 字符串内联，不读外部盘）；缺 `insert` → `ok:false`；缺 `id` 条目照常返回由规则报；tab 缩进 → `ok:false`。
- config：合法配置合并默认值；非法 JSON → CFG001；未知字段 → CFG002；未知规则 → CFG003；`rules:{PAT001:"fatal"}` → CFG003；waiver 缺 reason → CFG004；包级 `discovery` → CFG004。

**Verify:** 三个测试文件分别跑。

---

## Task 3：引擎、waiver、判定、报告、WALK/CFG 规则

**Files:**
- Create: `plugin-lint/lib/engine.mjs`, `plugin-lint/lib/report.mjs`
- Create: `plugin-lint/lib/rules/index.mjs`, `lib/rules/util.mjs`, `lib/rules/meta.mjs`
- Create: `plugin-lint/test/engine.test.mjs`

**Interfaces:**

```js
// rules/index.mjs
export const RULES            // 全量（含 meta）
export const RULE_BY_ID       // Map
export const PACKAGE_RULES    // kind === "package" 且 run 存在
export const TEXT_RULES       // kind === "text"

// engine
createContext({ dir, walk, manifest, manifestError, patch, config })
analyzePackage(dir, { now, onlyRules } = {}) -> PackageReport
lint({ dirs, root, depth, syntax, failOn, limit, now } = {}) -> Report
applyWaivers(findings, waivers) -> { kept, waived, used }

// report
buildReport({ packages, topFindings, now, tool, limit }) -> Report
renderMarkdown(report, { limit }) -> string
verdictOf(findings, failOn) -> "publishable"|"blocked"
```

**Implementation:**

- `analyzePackage` 顺序：`loadConfig`（先，拿 `ignore/limits`）→ `walkPackage` → `readManifest` → 若 `dsh.bundle.patch` 则读补丁文本并 `parsePatchYaml` → `createContext` → 配置 issues 物化 → `PACKAGE_RULES` → `TEXT_RULES`（按文件排序，逐个 `ctx.read`）→ `applyWaivers`（waiver 先于判定）→ 未命中 waiver 补 CFG004 → 全量 counts/verdict → 截断到 `limits.maxFindings`（截断时补 WALK003，`truncated:true`）→ checklist。
- `severityFor` 在物化时用 finding 的 scope（文件规则用 `file.scope`；包级用 `"package"`）。
- `applyWaivers`：`file` 精确匹配 `rel`，`rules` 含规则 id；`used` 记录 waiver 下标与次数。
- checklist：按 `category` 聚合；`error>0 → fail`、`warn>0 → warn`、否则 `pass`；语法检查被关闭时该 checklist `skipped`（由 `config.syntaxCheck === false` 决定）。
- `buildReport` 顶层汇总所有包 findings + topFindings；`counts` 与 `verdict` 用未截断数据计算；`waived` 累加。
- meta 规则：`WALK001`（`stats.large>0`，列前 3 个 `largeSkipped`，info）、`WALK002`（`truncated`，info）、`WALK003`（报告截断，info，由引擎在截断时补）、`WALK004`（读文件失败，warn；walk 把失败路径放 `ctx.readErrors`）、`CFG001-004`（元数据，不执行）、`DISCOVER001`（元数据，`lint` 顶层用）。
- `WALK004` 是对设计「读不了必须显式报」的机制补充，注册表与 README 都要列出。

**Tests（engine.test.mjs）:**

- 临时包：合法最小包（package.json + cordis.patch.yml + index.js + README + LICENSE + .gitignore）→ `publishable`，0 error。
- 加 `credential.json`（未忽略）→ 目前尚无 SEC 规则，先只断言 `files` 统计与 checklist 结构；SEC 任务再补。
- 配置 `rules:{DOC001:"off"}` 生效（引擎层面用 meta/伪造规则断言）。
- waiver：造一个命中 PAT001 的文件（路径用 `winPath`），waiver 命中后 counts 不计、`waived:1`；未命中 waiver → CFG004。
- 截断：`maxFindings:1` 时 `truncated:true` 且 verdict 不变。
- `buildReport` 的 JSON 形状：schemaVersion、counts、packages[].checklist 十项。

**Verify:** `node test/engine.test.mjs`；包级输出手工看一次。

---

## Task 4：PKG001-009、011-013 与 PATCH001-005

**Files:**
- Create: `plugin-lint/lib/rules/manifest.mjs`, `lib/rules/patch.mjs`
- Create: `plugin-lint/test/rules-manifest.test.mjs`
- Modify: `lib/rules/index.mjs`（注册）

**Rules:** 按设计 §4.5 表实现；severity 用表里的默认值。

**Implementation notes:**

- PKG001 由 `manifestError` 触发；PKG002 npm 名（`^[a-z0-9][a-z0-9._-]*$`，≤214）；PKG003 简单 semver（`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`）。
- PKG006/007：`exportTargets` 的目标存在性；含 `*` 时用 `ctx.files` 匹配，无命中 → error。
- PKG009：`files` 每项有 `*` 时至少命中一个，字面量必须存在。
- PKG010：入口集合 = `exportTargets` 目标 + `dsh.bundle.patch` + `bin`；从入口 BFS 相对 import（`lib/imports.mjs` 在下一个任务才建，本任务先只检查入口文件本身，Task 6 完成后扩展为递归并补测试——**不留 TODO**：本任务实现 BFS 的骨架，`extractImports` 未就绪时用一个最小本地函数？不，改为把 PKG010 放到 Task 6 一起做，本任务只做 PKG001-009、011-013。
- PKG011：`manifest.dsh.bundle.patch` 缺失 → error。
- PKG012：任一 `.js`（非 `.mjs/.cjs`）文本里出现行首 `import `/`export ` 且 package 无 `type:"module"` → error。
- PKG013：`dependencies` 值以 `file:`/`link:` 开头 → warn。
- PATCH001：补丁文本读不到或 `parsePatchYaml.ok === false`；PATCH002：`entries.length === 0`；PATCH003：条目缺 id/name；PATCH004：重复 id；PATCH005：`name` 不是本包且 `createRequire` 解析不到。

**Tests:** 每个 ID 至少一正一反；特别覆盖：缺 name/version、exports 指向不存在、exports `*` 无命中、files 缺项、无 patch、ESM `.js` 无 type、`file:` 依赖、补丁重复 id、补丁 name 解析失败。

**Verify:** `node test/rules-manifest.test.mjs`。

---

## Task 5：PAT001 与 ENC001-005

**Files:**
- Create: `plugin-lint/lib/rules/patterns.mjs`, `lib/rules/paths.mjs`, `lib/rules/encoding.mjs`
- Create: `plugin-lint/test/rules-paths-encoding.test.mjs`
- Modify: `lib/rules/index.mjs`

**Implementation:**

- `patterns.mjs` 只放数据：`ABS_PATH`、`PLACEHOLDER`、`URL`、`SECRET`、`MOJIBAKE`、`CREDENTIAL_FILE`、`EXAMPLE_FILE`。**不要在这里写注释里的真实路径示例**；需要示例用 `<path>`。
- PAT001：对每个 text 文件逐行匹配 `ABS_PATH`（`\b[A-Za-z]:\\`、`\\\\[^\\\s]+\\`、`/(home|Users|root|opt|mnt|var|tmp)/`、`file:///`）；行内若在 `http(s)://` 的 URL 区间则跳过；命中片段含 `PLACEHOLDER`（`<...>`、`...`、`path\to`、`your`、`example`、`xxx`、`foo`）→ info + 「示例路径」；否则按 scope（runtime error / test warn / docs info）。snippet 取该行、最多 120 字符、把盘符后两段用 `…` 打码。
- ENC001：`TextDecoder("utf-8",{fatal:true})` 解码失败 → error（附「疑似 GBK/ANSI」）；ENC002：`EF BB BF` → warn；ENC003：`FF FE`/`FE FF`/`FF FE 00 00`/`00 00 FE FF` → error；ENC004：解码成功但含 `\uFFFD` 或 `MOJIBAKE`（典型乱码串）→ warn；ENC005：以 `#!` 开头且含 `\r\n` → warn。ENC001 命中时不再跑 ENC004（避免双报）。
- 文本规则只对 `file.kind === "text"` 执行；`binary/large` 跳过。

**Tests:** runtime/test/docs 三级；URL 内 `/home/` 不报；占位符 `D:\...\path\to` 降 info；GBK 字节（`new Uint8Array([0xD6,0xD0])` 写文件）→ ENC001；UTF-8 BOM → ENC002；UTF-16LE BOM → ENC003；典型乱码串 → ENC004；shebang CRLF → ENC005；全部只报对应规则。

**Verify:** `node test/rules-paths-encoding.test.mjs`。

---

## Task 6：import 抽取 + DEP001-006 + PKG010 递归

**Files:**
- Create: `plugin-lint/lib/imports.mjs`, `lib/rules/deps.mjs`
- Modify: `lib/rules/manifest.mjs`（PKG010 BFS）、`lib/rules/index.mjs`
- Create: `plugin-lint/test/imports.test.mjs`, `plugin-lint/test/rules-deps.test.mjs`

**Interfaces:**

```js
extractImports(source) -> [{ spec, line, column, dynamic, type: "import"|"export"|"require"|"dynamic" }]
```

**Implementation:**

- 小型词法扫描：跳过 `//`、`/* */`、单双引号字符串、模板字符串（`${}` 内继续扫但简单处理）；识别 `import ... from 'x'`、`import 'x'`、`export ... from 'x'`、`import('x')`、`require('x')`、`import.meta`（忽略）。多行 import 支持。
- `deps.mjs`：对每个 text runtime/test 文件抽 import；`node:`/URL/裸 `#` 跳过；相对路径 → `createRequire(file.abs).resolve(spec)`；失败 → DEP001；解析结果在包外 → DEP005；裸包 → 解析失败 DEP002；成功但未在 `dependencies/peerDependencies/optionalDependencies` → DEP003；runtime 文件命中 `devDependencies` → DEP004；动态非字面量 → DEP006 info（`spec` 为空）。
- `hybrid`：`createRequire` 以文件为基；解析基目录写进 finding 的 `hint`。
- PKG010：入口 BFS（相对 import 递归，最多 2000 个文件）；`filesMatcher(manifest)` 为 false 且 scope runtime → error；`files` 缺失不报。

**Tests:** 注释/字符串里的伪 import 不抽；多行；`import.meta`；动态字面量 `import("./x.mjs")` 不报 DEP006；相对缺失 DEP001；包外 `../../outside.mjs` DEP005；裸包缺 DEP002（用不存在的包名）；未声明 DEP003（用 `node:test`? 不算裸包——用真实存在的 `semver` 若未声明；环境可能没有，改用不存在的包覆盖 DEP002，DEP003 用 `fs` 非 node: 前缀？`fs` 是核心模块，`createRequire.resolve('fs')` 成功且未声明——会被 DEP003 误报！必须在 DEP 规则里跳过 `module.isBuiltin(spec)`）。DEP004 用 devDependencies 里的假包。
- PKG010：入口 import 一个不在 `files` 里的 `lib/x.mjs` → error；在 files 里 → 不报。

**Verify:** 两个测试文件。

---

## Task 7：SEC001-003、REPO001-005、DOC/DSP

**Files:**
- Create: `plugin-lint/lib/rules/secrets.mjs`, `lib/rules/repo.mjs`, `lib/rules/display.mjs`
- Create: `plugin-lint/test/rules-secrets-repo.test.mjs`, `plugin-lint/test/rules-display.test.mjs`
- Modify: `lib/rules/index.mjs`

**Implementation:**

- SEC001：published 的 `rel` basename 命中 `CREDENTIAL_FILE`（`credential*.json`、`*secret*.json`、`*.pem`、`*.key`、`id_rsa*`、`.env*`、`*.p12`、`*.keystore`），但 `EXAMPLE_FILE`（`*.example.*`、`*.sample.*`、`.env.example`）除外 → error；hint 按设计口径。
- SEC002：text 文件命中 `SECRET`（私钥块、`sk-`、`ghp_`、`xox[baprs]-`、`AKIA...`、长 Bearer、`password` 赋值）；runtime error / test warn / docs error；值打码为 `类型…(N chars)`；占位符（`your`、`xxx`、`example`、`<...>`、`...`）→ info。
- SEC003：`ignoredFiles` 命中凭证名，或 published 命中示例名 → info。
- REPO001：published 无 `.gitignore` → warn；REPO002：`prunedDirs` 有 `node_modules` 且 `ignored:false` → error；REPO003/004：published 文件 size 超阈值 → warn/error；REPO005：`.venv`/`__pycache__`/`.cache` 未忽略 → info。
- DOC001：published 无 `README.md`（大小写不敏感）→ warn；DOC002：manifest.license 存在但无 `LICENSE*` → warn。
- DSP001：`exports["./icon"]` 或顶层 `icon` 指向不存在 → error；DSP002：存在但扩展名不在 `svg/png/jpg/jpeg/webp` 或 >256KiB → warn；DSP003：`locale/*.json` 解析失败 → error；DSP004：locale 缺 `meta.title/description` → warn；DSP005：有 `locale/` 但 exports 无 `./locale/*.json` → warn。

**Tests:** 每个 ID 一正一反；SEC002 断言输出不含完整密钥；SEC003 仅在 ignored 集合；REPO002 用未忽略 `node_modules`；DSP 用临时 locale。

**Verify:** `node test/rules-secrets-repo.test.mjs`、`node test/rules-display.test.mjs`。

---

## Task 8：SYN001-002 语法检查

**Files:**
- Create: `plugin-lint/lib/rules/syntax.mjs`
- Create: `plugin-lint/test/rules-syntax.test.mjs`
- Modify: `lib/rules/index.mjs`, `lib/engine.mjs`（把 `syntaxCheck` / `syntaxMaxFiles` / `syntaxConcurrency` 传入规则）

**Implementation:**

- 候选：published text 文件，`.mjs`/`.cjs`，以及 `manifest.type === "module"` 时的 `.js`；`.js` 无 type → 跳过并计 SYN002（只报一条汇总）。
- 用 `process.execPath --check <file>`，`env: {...process.env, ELECTRON_RUN_AS_NODE:"1"}`，`timeout: 10000`，并发 4；失败 → SYN001 error，stderr 第一行进 message。
- 超过 `syntaxMaxFiles` → SYN002 info，写明跳过数量；spawn 失败/超时 → SYN002 info，写明「语法未检查」。
- `config.syntaxCheck === false` → 不跑，checklist 标 skipped（引擎已处理），不报 SYN002。

**Tests:** 合法文件不报；坏文件（`const =`）→ SYN001；`syntaxCheck:false` → 0 SYN；`syntaxMaxFiles:1` 两文件 → SYN002；spawn 失败模拟（把 `process.execPath` 指到不存在？不改全局——规则接受 `opts.spawn` 注入，测试注入抛错函数）→ SYN002。

**Verify:** `node test/rules-syntax.test.mjs`；若沙箱 spawn 受限，测试里注入 fake spawn，另加一条真实 spawn 的可选测试（失败即 skip）。

---

## Task 9：发现 + CLI

**Files:**
- Create: `plugin-lint/lib/discover.mjs`, `lib/cli.mjs`, `bin/plugin-lint.mjs`
- Create: `plugin-lint/test/discover.test.mjs`, `test/cli.test.mjs`
- Modify: `lib/engine.mjs`（`lint({root})` 先读扫描根 `.pluginlint.json`，只取 `discovery.depth` 与用于跳过目录的 `ignore`）

**Implementation:**

- `discoverPackages(root,{depth, ignore})`：BFS/DFS，跳过 `PRUNE_DIRS`、隐藏目录与根配置 `ignore` 命中的目录；候选 = `package.json` 且（`dsh.bundle.patch` 或存在 `cordis.patch.yml`）；命中后不向下；`depth` 是相对 root 的最大层数（root 本身 depth 0，但 root 不作为候选，避免把工作区根当包）；返回绝对路径排序。
- `lint({root})`：`depth` 参数 > 根配置 `discovery.depth` > 3；根配置非法时，发现阶段不中断，把该 issue 作为顶层 finding 带出（CFG001）。
- `runCli(argv, io)`：解析 `dirs`/`--root`/`--depth`/`--json`/`--out`/`--fail-on`/`--no-syntax`/`--quiet`/`--help`；无参 → root=io.cwd；`--root` 与 dirs 互斥；`--out` 写 `plugin-lint-report.md` 与 `.json`（mkdired）；stdout 输出；`--quiet` 只输出结论一行；退出码 0/1/2。
- `bin/plugin-lint.mjs`：`#!/usr/bin/env node`，调 `runCli(process.argv.slice(2), {cwd: process.cwd(), stdout, stderr})`，`process.exitCode = code`。
- CLI 不做工作区 API 探测；默认 cwd（与工具一致）。

**Tests:** discover 嵌套包、非插件目录、深度限制、node_modules 跳过、根配置 depth 生效；cli：`--json` 输出可 JSON.parse、`--out` 生成两文件、退出码 blocked=1/publishable=0、`--help`=0、非法参数=2。

**Verify:** 两个测试文件；`node bin/plugin-lint.mjs 'D:\OPCG\plugins\dsh-opcg-cards'` 手工看（预期 blocked + PAT001）。

---

## Task 10：DSH 工具壳 + 展示资源

**Files:**
- Create: `plugin-lint/index.js`, `locale/zh.json`, `locale/en.json`, `README.md`, `LICENSE`, `.pluginlint.json`
- Modify: `package.json`（若 exports/files 需补）

**Implementation:**

- `index.js`：`export const name = 'dsh-plugin-lint'`；`inject = ['tools','systemPrompt']`；`apply(ctx)` 里注册 systemPrompt section 与 `plugin_lint` 工具。
- 工具参数按设计 §4.9；`dir`/`root` 互斥；默认 root = `process.env.DSH_WORKSPACE || process.cwd()`（当前环境无 `DSH_WORKSPACE`，会走 cwd）。
- 输出：`json` 时返回 `JSON.stringify(report,null,2)`；否则 `renderMarkdown(report,{limit: detail ? 200 : limit})`；`out` 时写两文件；总输出 >60KB 截断并提示 `json`/`out`。
- 错误（无候选、参数冲突、扫描失败）返回可读字符串，不抛。
- `locale/zh.json`、`en.json` 按 DSH 格式 `{meta:{title,description}}`；`icon.svg` 简单几何图形（线性、currentColor）；`README.md` 写安装、用法、规则表、退出码、豁免说明；`LICENSE` MIT（版权行 `Copyright (c) 2026 3438278672-ops`）。
- `.pluginlint.json`：只放 `lib/rules/patterns.mjs` 的 waiver（rules: PAT001、SEC002、ENC004、MOJIBAKE 相关），reason 写清「规则模式表本身就是检测特征」。

**Tests:** 用假 `ctx` 调 `apply`，断言 `tools.register` 收到 name/parameters；直接调 `execute({dir})` 断言字符串包含「可发/不可发」。不装插件也能测。

**Verify:** `node --check index.js`；用假 ctx 的测试绿。

---

## Task 11：自检、真实仓库验收、推送

**Steps:**

- [ ] 从 `plugin-lint` 跑 `node bin/plugin-lint.mjs . --json`：必须 `verdict:"publishable"`、`counts.error === 0`；waived 只来自 patterns.mjs。
- [ ] 有 finding 就修源码/配置，**不许**用全局 ignore 或关规则糊过去；只有模式表可 waiver。
- [ ] 跑 `node bin/plugin-lint.mjs 'D:\OPCG\plugins\dsh-opcg-tickets'`：预期 blocked，命中 SEC001 + 缺 LICENSE/.gitignore。
- [ ] 跑 `node bin/plugin-lint.mjs 'D:\OPCG\plugins\dsh-opcg-cards'`：预期 blocked，命中 PAT001。
- [ ] `node --test test/`（若 EPERM 则逐个跑）全绿。
- [ ] 更新 `toolbox/README.md`：plugin-lint 用法摘要 + 规则 ID 表。
- [ ] `git add -A && git commit -m "feat: dsh-plugin-lint ..."`；`git push -u origin main`（SSH）。
- [ ] 推送后 `git ls-remote origin` 确认分支存在；报告 commit hash。

**Acceptance:** 设计 §6 六条全部满足；报告里给出三条实跑命令与结论。

---

## 自审记录

- **spec 覆盖**：范围、规则表、配置、报告、工具、CLI、发现、测试、验收都有任务承接；`WALK004` 是为「读不了必须报」补的机制，已注明。
- **占位符**：没有 TBD/TODO；PKG010 明确移到 Task 6（依赖 import 抽取），不是留空。
- **类型一致性**：`PackageContext`、`Finding`、`PackageReport`、`Report` 在各任务引用同一形状；`severityFor` 只在一处实现。
- **风险**：Task 1 的 walker 与 Task 2 的 patch 解析最重，先做且测试最密；Task 8 的子进程在沙箱可能受限，已设计依赖注入。
```
