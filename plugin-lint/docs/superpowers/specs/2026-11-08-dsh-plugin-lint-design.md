# dsh-plugin-lint 设计

日期：2026-11-08
状态：已确认（2026-11-08 用户批准；builder check 后修订）

## 1. 意图

插件开发时很容易把本机的东西带进仓库：`D:\OPCG\...` 这类绝对路径、GBK 写出的中文文件、缺字段的清单、没声明的依赖、甚至 `credential.json`。目标是给 DSH 插件一条发布前的硬闸：**把一个插件目录当成「要传到 GitHub 的包」来审，回答「能不能发」**。

实现原则（用户明确要求）：按机制实现，不做打补丁式的最小改动。规则、判定、豁免都必须是数据/契约层的东西，不是散落的 if。

## 2. 目标与非目标

### 目标

1. 输入一个或多个插件包目录，输出可解释的检查结果：每条问题都有规则 id、文件:行、原因、修法。
2. 覆盖四类核心问题：**绝对路径硬编码、非 UTF-8 编码、清单/入口不完整、依赖缺失**。
3. 覆盖发布卫生：凭证泄露、`.gitignore` 覆盖、README/LICENSE、图标/locale、补丁文件、大文件与误提交产物。
4. 同一引擎两个出口：DSH 工具 `plugin_lint` 与 CLI `plugin-lint`；报告同时支持 Markdown 检查单与稳定 JSON。
5. 规则可配置（改严重级、关规则、忽略路径、显式豁免），可测试，可扩展：加规则 = 加一条数据，不改主流程。

### 非目标

- **不自动修改文件**。只报告并给出修法；修复由人或 agent 按报告执行。
- 不做通用代码风格/格式检查（那是 formatter/linter 的事）。
- 不做安全审计（不是 SAST）；密钥检查只针对已知凭证形态。
- 不加载、不执行被扫插件的代码（语法检查只跑 `node --check`）。
- 本期不扫描 profile 里「已安装」的插件，只扫源码目录。

### 反目标（做到这些就算失败）

- 把 `node_modules`、浏览器 profile、二进制文件当文本扫，产出成千上万条假阳性。
- 出现无法解释的 finding：指不到具体位置，或没有修法。
- 静默跳过：读不了/解析不了的文件必须显式报 skip，不能当作通过。
- 报告里泄漏真实密钥（命中内容必须打码）。

## 3. 约束

- **零运行时依赖**：只用 `node:` 内置模块（`fs`、`path`、`module`、`url`、`child_process`、`TextDecoder`）。理由：插件要「独立、能直接传 GitHub」，不引入安装期联网与 `node_modules`。
- **只读**：不往被扫目录写任何文件；报告只写到调用方指定的 `out` 目录。
- **跨平台**：以 Windows 为主，POSIX 下路径规则同样生效；路径统一用 `/` 表示相对包根。
- **可自检**：插件自己必须通过自己的检查（0 error）；规则模式表的自匹配用显式 waiver 处理，不用全局 ignore 留白。
- **性能**：5000 个文件、50 MiB 文本量级，**不含语法检查**单次扫描 < 3 秒；语法检查单独计时，默认限 300 个文件、4 并发。

## 4. 方案

### 4.1 候选与选择

- **A. 单文件正则扫描**：最快，但规则与判定写死在主流程里，误报只能靠特判压，扩展要改核心。否决：属于打补丁式实现。
- **B. 零依赖规则引擎（选中）**：文件集合、元数据、规则、报告四层分离；规则是注册表数据；依赖用真解析（`createRequire().resolve`）而不是正则猜。
- **C. B + 外部依赖**（acorn / ignore / js-yaml）：解析最准，但插件从此有 `dependencies`，安装要联网，和发布目标冲突。否决。

### 4.2 分层

```
文件集合层  lib/walk.mjs + lib/gitignore.mjs
            决定「git 会发布什么」；规则只看这里产出的集合
元数据层    lib/manifest.mjs + lib/patch.mjs + lib/config.mjs
            解析 package.json、cordis.patch.yml、.pluginlint.json
规则层      lib/rules/*.mjs
            纯函数：(ctx) => findings；规则表在 lib/rules/index.mjs
报告层      lib/report.mjs
            verdict、Markdown 检查单、JSON（schemaVersion 1）
外壳        index.js（DSH 工具）、lib/cli.mjs + bin/plugin-lint.mjs、lib/discover.mjs
```

关键契约：**规则只接收 `PackageContext`，不自己读盘**。这样规则可以脱离文件系统测试，walk 的忽略语义也只在一处实现。

### 4.3 文件集合（机制核心）

遍历包目录，产出三类条目，规则按用途取用：

| 集合 | 内容 | 用途 |
|---|---|---|
| `published` | 会进 git 的文件（未被忽略） | 路径、编码、依赖、密钥、大文件、清单等全部主检查 |
| `ignoredFiles` | 被 `.gitignore` / `config.ignore` **显式**忽略的文件 | SEC003「存在但已忽略」提示与统计 |
| `prunedDirs` | 命中固定裁剪表的目录：存在、是否被 gitignore 覆盖、不进入 | REPO002/REPO005 判断是否会被提交，避免遍历爆炸 |

- 固定裁剪表（数据表，非特判）：`node_modules`、`.git`、`.hg`、`.svn`、`.venv`、`__pycache__`、`.cache`、`.DS_Store`。
- `.gitignore` 语义子集：空行与 `#` 注释；`!` 取反；结尾 `/` 只匹配目录；前导 `/` 锚定包根；中间 `/` 锚定；`*` 不跨 `/`，`**` 跨目录，`?` 单字符，`[...]` 字符类；后匹配覆盖前匹配。
- 被忽略的目录不进入（与 git 一致：目录内文件不能靠 `!` 单独救回）；目录本身记入 `prunedDirs(reason='gitignore')`。
- 叠加 `.pluginlint.json` 的 `ignore` glob（包根相对）。
- 文件分类（读前 8 KiB 判定）：
  - `binary`：含 NUL 且不是 UTF-16/32 BOM；
  - `text`：其余；
  - `large`：超过 `limits.maxFileBytes`（默认 4 MiB）——内容不读，按包报一条 WALK001。
- 二进制与 `large` 仍属于 `published`（它们要进仓库），只是不做文本规则。
- `maxFiles`（默认 20000）防呆：达到上限即停止深入，记 WALK002，不静默。

### 4.4 PackageContext

```js
{
  dir, name, version,
  manifest,              // package.json 解析结果或 null
  patch,                 // cordis.patch.yml 解析结果或 null
  config,                // .pluginlint.json 合并默认值后的结果
  files:        [{ rel, abs, size, kind: 'text'|'binary'|'large', scope }],  // published
  ignoredFiles: [{ rel, size, kind, rule }],     // 被显式忽略的文件
  prunedDirs:   [{ rel, reason: 'vendor'|'gitignore', ignored: boolean }],
  stats:        { published, ignored, pruned, binary, text, large },
  sources: Map<rel, string>,                     // 按需读取的文本
  findings: [],
}
```

`scope` 由固定路径表推导，不靠扩展名猜：

| scope | 规则 |
|---|---|
| `test` | `test/**`、`tests/**`、`__tests__/**`、`spec/**`、`fixtures/**`、`**/*.test.*`、`**/*.spec.*` |
| `docs` | `*.md`、`*.mdx`、`docs/**`、`LICENSE*`、`CHANGELOG*`、`*.rst` |
| `runtime` | 其余（含 `bin/**`、`scripts/**`、`*.ps1`、`*.sh`） |

### 4.5 规则表

严重级的默认值按 scope 给出；`error` 阻断发布，`warn` 应修，`info` 提醒。未列出的 scope 列表示与 runtime 相同。包级 finding（`file` 为 `null`）用于聚合型问题。

#### 遍历与配置（walk / config）

| ID | 检查 | 默认级别 |
|---|---|---|
| WALK001 | 有文件超过 `maxFileBytes`，内容未扫描（附数量与前几个路径） | info（包级） |
| WALK002 | 文件数达到 `maxFiles`，扫描提前停止 | info（包级） |
| WALK003 | findings 超过 `maxFindings`，报告截断（判定仍按全量） | info（包级） |
| CFG001 | `.pluginlint.json` 缺失或 JSON 非法（缺失不报，非法报） | error |
| CFG002 | 配置出现未知字段 | info |
| CFG003 | 未知规则 id 或非法级别 | warn |
| CFG004 | waiver 缺 `reason`、未命中任何 finding，或在包级配置里写了 `discovery` | warn |
| DISCOVER001 | 工作区里没有发现任何候选插件包 | info（报告顶层） |

#### 清单与补丁（manifest / patch）

| ID | 检查 | 默认级别 |
|---|---|---|
| PKG001 | `package.json` 缺失或 JSON 解析失败 | error |
| PKG002 | `name` 缺失或不符合 npm 命名规则 | error |
| PKG003 | `version` 缺失或不是 semver | error |
| PKG004 | `description` 缺失 | warn |
| PKG005 | `license` 缺失 | warn |
| PKG006 | 既没有 `exports` 也没有 `main` | warn |
| PKG007 | `exports` / `main` 指向的文件不存在 | error |
| PKG008 | `files` 缺失 | warn |
| PKG009 | `files` 里列了不存在的路径 | warn |
| PKG010 | 从入口（exports/main/patch）可达的运行时文件不在 `files` 里 | error |
| PKG011 | `dsh.bundle.patch` 缺失 | error |
| PKG012 | 源码用 ESM 语法但清单没有 `"type": "module"` | error |
| PKG013 | `dependencies` 里有 `file:` / `link:` 依赖（发布后必坏） | warn |
| PATCH001 | 补丁文件读不到，或 YAML 子集解析失败（tab 缩进、结构非法） | error |
| PATCH002 | 补丁里没有任何 `insert` 行 | error |
| PATCH003 | insert 行缺 `id` 或 `name` | error |
| PATCH004 | 同一补丁内 `id` 重复 | warn |
| PATCH005 | 行 `name` 不是本包且解析不到该包 | warn |

`exports` 按 Node 语义处理：字符串形式等价于 `"."`；对象形式支持子路径与 `*` 通配；`main` 作为兜底。图标认 `exports["./icon"]`，也兼容包根顶层 `icon` 字段。

#### 路径可移植（paths）

| ID | 检查 | 默认级别 |
|---|---|---|
| PAT001 | 文本里出现机器相关绝对路径：盘符 `X:\`、UNC、`/home/`、`/Users/`、`/root/`、`/opt/`、`/mnt/`、`/var/`、`/tmp/`、`file:///` | runtime error / test warn / docs info |

补充口径（规则内部的数据表，不是特判）：

- 命中片段含占位符标记（`<...>`、`...`、`path\to`、`your`、`example`、`xxx`、`foo`）→ 降为 info，并注明「示例路径」。
- 命中位于 `http://` / `https://` URL 内 → 不算。
- 报告里给出**脱敏后的上下文**（只显示一行，最多 120 字符）。

#### 编码（encoding）

| ID | 检查 | 默认级别 |
|---|---|---|
| ENC001 | 不是合法 UTF-8（严格解码失败，通常是 GBK/ANSI） | error |
| ENC002 | UTF-8 BOM | warn |
| ENC003 | UTF-16 / UTF-32 BOM | error |
| ENC004 | 文本含 U+FFFD 或典型乱码串（`锟斤拷`、`ï¿½`） | warn |
| ENC005 | 带 `#!` shebang 的文件使用 CRLF | warn |

#### 依赖完整（dependencies）

静态抽取 `import ... from 'x'`、`import 'x'`、`export ... from 'x'`、`import('x')`、`require('x')`（跳过注释与字符串内部的伪代码），然后：

| ID | 检查 | 默认级别 |
|---|---|---|
| DEP001 | 相对路径 import 解析不到 | error |
| DEP002 | 裸包 import 解析不到 | error |
| DEP003 | 裸包能解析但没在 `dependencies`/`peerDependencies`/`optionalDependencies` 声明 | warn |
| DEP004 | runtime 文件 import 了 `devDependencies` 里的包 | error（test scope 不报） |
| DEP005 | 相对路径 import 解析到包外 | error |
| DEP006 | 动态 import/require 的参数不是字面量，无法验证 | info |

解析统一用 `createRequire(importingFile).resolve(spec)`，因此相对路径、扩展名、目录 `index.js`、包的 `exports` 字段都按 Node 的真实规则走。报告写明解析基目录，避免「装了但解析不到」的误解。

#### 凭证泄露（secrets）

| ID | 检查 | 默认级别 |
|---|---|---|
| SEC001 | 发布集合里有凭证类文件：`credential*.json`、`*secret*.json`、`*.pem`、`*.key`、`id_rsa*`、`.env*`、`*.p12`、`*.keystore` | error |
| SEC002 | 文本命中密钥特征：私钥块、`sk-`、`ghp_`、`xox[baprs]-`、`AKIA...`、长 `Bearer`、`password=...` | runtime error / test warn / docs error；疑似占位符降为 info |
| SEC003 | 凭证类文件存在但已被忽略，或命中示例文件命名（`*.example.*`、`*.sample.*`、`.env.example`） | info |

SEC001 的修法按 SEC003 的口径写：**删除或加入 `.gitignore`；要留示例就改名成 `credential.example.json` 并写假值**——示例文件不会再命中 SEC001。

报告只输出命中类型与打码后的片段（如 `sk-…(41 chars)`），绝不输出完整值。

#### 仓库卫生（repo）

| ID | 检查 | 默认级别 |
|---|---|---|
| REPO001 | 没有 `.gitignore` | warn |
| REPO002 | 存在 `node_modules/` 且未被 `.gitignore` 覆盖（会被 git 提交） | error |
| REPO003 | 单文件超过 `limits.largeFileWarnBytes`（默认 5 MiB） | warn |
| REPO004 | 单文件超过 `limits.largeFileErrorBytes`（默认 50 MiB） | error |
| REPO005 | 存在 `.venv`、`__pycache__`、`.cache` 且未被忽略 | info |

REPO003/004 与 WALK001 是两件事：前者说「这个文件大，不该这样进仓库」，后者说「太大没扫内容」。同一文件可能两条都报，各自可关。

#### 文档与展示（docs / display）

| ID | 检查 | 默认级别 |
|---|---|---|
| DOC001 | 缺 `README.md` | warn |
| DOC002 | 声明了 `license` 但目录里没有 `LICENSE*` | warn |
| DSP001 | `exports["./icon"]` / 顶层 `icon` 声明的图标不存在 | error |
| DSP002 | 图标格式不可识别或超过 256 KiB | warn |
| DSP003 | locale JSON 解析失败 | error |
| DSP004 | locale 缺 `meta.title` / `meta.description` | warn |
| DSP005 | 有 `locale/` 但清单没导出 `./locale/*.json` | warn |

#### 语法（syntax，深度检查）

| ID | 检查 | 默认级别 |
|---|---|---|
| SYN001 | `node --check` 失败 | error |
| SYN002 | 语法检查被跳过（文件过多、node 不可用、清单缺 `type: module` 导致无法判定） | info |

语法检查通过 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 调 `--check`，不依赖外部 node；默认开启，可用配置或 CLI 关闭。只检查 `.mjs/.cjs`，以及 `type: "module"` 时的 `.js`；`.js` 缺 `type: module` 由 PKG012 负责，语法检查跳过并记 SYN002。

### 4.6 严重级与判定

- verdict：存在 `error`（或达到 `failOn` 阈值的 finding）→ `blocked`，否则 `publishable`。
- 配置的 `rules` 可把任意规则改为 `off|info|warn|error`；`ignore` 可整段排除路径。
- **报告必须解释每一条 error 为什么阻断**：finding 的 `hint` 字段给出具体修法，不允许空话。
- 规则被 `off` 时在 JSON 里保留 `disabledRules` 列表，报告注明「本次有 N 条规则被关闭」，避免「看起来全绿其实没查」。
- **findings 全量计算**；`maxFindings` 只截报告，不截判定。截断时 `truncated: true` 并记 WALK003。
- **waiver 先于判定应用**：命中 waiver 的 finding 不进入 counts/verdict，但计入 `waived` 并在报告里列出用了哪条 waiver、豁免了几条，绝不静默。

### 4.7 配置 `.pluginlint.json`

```json
{
  "ignore": ["fixtures/**", "vendor/**"],
  "rules": {
    "DOC001": "off",
    "PAT001": "warn"
  },
  "waivers": [
    {
      "file": "lib/rules/patterns.mjs",
      "rules": ["PAT001", "SEC002", "ENC004"],
      "reason": "规则模式表：字符串本身就是检测特征"
    }
  ],
  "failOn": "error",
  "syntaxCheck": true,
  "limits": {
    "maxFileBytes": 4194304,
    "largeFileWarnBytes": 5242880,
    "largeFileErrorBytes": 52428800,
    "maxFiles": 20000,
    "maxFindings": 500,
    "syntaxMaxFiles": 300,
    "syntaxConcurrency": 4
  },
  "discovery": { "depth": 3 }
}
```

- 包根配置按包生效。`CFG001` JSON 非法 → error；`CFG002` 未知字段 → info；`CFG003` 未知规则 id → warn；`CFG004` waiver 缺 reason/未命中、或包级写了 `discovery` → warn。
- `failOn` 可选 `error|warn|info|none`。
- **加载时序**：发现阶段只读「扫描根」的 `.pluginlint.json`（只取 `discovery` 与用于跳过目录的 `ignore`）；发现完成后，每个包再读自己的配置。包级 `discovery` 不生效并报 CFG004。

### 4.8 报告

JSON（`schemaVersion: 1`）：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-08T01:00:00.000Z",
  "tool": { "name": "dsh-plugin-lint", "version": "0.1.0" },
  "verdict": "blocked",
  "counts": { "error": 2, "warn": 3, "info": 1 },
  "waived": 2,
  "disabledRules": [],
  "findings": [],
  "packages": [{
    "dir": "…",
    "name": "dsh-opcg-tickets",
    "version": "0.1.0",
    "verdict": "blocked",
    "counts": { "error": 1, "warn": 2, "info": 0 },
    "waived": 0,
    "truncated": false,
    "files": { "published": 12, "ignored": 4, "pruned": 3, "binary": 2, "text": 10, "large": 0 },
    "checklist": [
      { "id": "manifest", "title": "清单与入口完整", "status": "fail", "error": 1, "warn": 0 }
    ],
    "findings": [{
      "rule": "SEC001",
      "category": "secrets",
      "severity": "error",
      "scope": "runtime",
      "file": "credential.json",
      "line": 1,
      "column": 1,
      "message": "发布集合里包含凭证文件 credential.json",
      "hint": "删除该文件或加入 .gitignore；要留示例就改名 credential.example.json 并写假值",
      "snippet": "（内容已省略）"
    }]
  }]
}
```

- 顶层 `findings` 放 DISCOVER001 这类不属于某个包的问题；包级聚合问题（WALK/CFG）`file` 为 `null`。
- Markdown 结构：

```markdown
# 插件发布前自检

结论：不可发（1 个包，2 error / 3 warn / 1 info；waived 2）
生成时间：…  工具：dsh-plugin-lint 0.1.0

## dsh-opcg-tickets — 不可发
文件：发布 12 / 忽略 4 / 裁剪 3 / 二进制 2 / 超大跳过 0

| 级别 | 规则 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| error | SEC001 | credential.json:1 | 发布集合里包含凭证文件 | 删除或加入 .gitignore |

### 检查单
- [x] 清单与入口完整
- [ ] 无凭证泄露（1 error）
- [x] 路径可移植
…
```

检查单固定十项（按包输出）：清单与入口、补丁与注册、路径可移植、编码统一、依赖完整、无凭证泄露、仓库卫生、文档与展示、语法可加载、配置与豁免。

### 4.9 DSH 工具 `plugin_lint`

参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `dir` | string | 单个插件包目录；与 `root` 二选一 |
| `root` | string | 工作区根，自动发现插件包 |
| `depth` | integer | 发现深度，覆盖根配置，默认 3 |
| `detail` | boolean | 输出全部 findings（默认每包前 12 条） |
| `json` | boolean | 返回 JSON 而不是 Markdown |
| `out` | string | 报告目录；写 `plugin-lint-report.md` 与 `.json`，默认不落盘 |
| `syntax` | boolean | 是否运行语法检查，默认 true |
| `limit` | integer | 文本模式每包最多显示几条（1–200，默认 12） |

默认 `root`：优先取插件运行时能拿到的**会话工作区**（实现时用 `cordis_inspect` 确认宿主暴露的服务）；拿不到则退回 `process.cwd()`。若该目录下发现 0 个候选包，报 DISCOVER001 并提示显式传 `dir`/`root`，**不**自动改扫别的目录。

输出上限 60 KB；超限时截断并提示用 `json`/`out` 取全量。工具只读，不修改被扫目录。

### 4.10 CLI

```
plugin-lint [dirs...] [--root <dir>] [--depth <n>] [--json] [--out <dir>]
            [--fail-on error|warn|info|none] [--no-syntax] [--quiet]
```

- 无位置参数且无 `--root` → 以当前目录为根做自动发现。
- 退出码：`0` 可发、`1` 被阻断、`2` 工具自身失败。
- `bin/plugin-lint.mjs` 只做参数解析与进程退出；核心逻辑在 `lib/cli.mjs` 的 `runCli(argv, io)`，可在测试里直接调用，不 spawn。

### 4.11 工作区自动发现

- 根 = `--root` / 工具 `root` / 扫描根配置 / 默认工作区，优先级从高到低。
- `depth` = 参数 > 根配置 > 3。
- 候选：目录里有 `package.json`，且（有 `dsh.bundle.patch` 或存在 `cordis.patch.yml`）。
- 找到包后不再向下递归；跳过 `node_modules`、`.git`、隐藏目录与裁剪表目录。
- 没有候选 → 报一条顶层 DISCOVER001 info，不报 error。

### 4.12 性能与边界

- 单次遍历；文本按需读取；二进制只读 8 KiB 头部；`maxFiles`/`maxFileBytes` 防呆。
- 语法检查单独计时：并发 4、最多 300 个文件（可配），超出记 SYN002 并写明跳过了多少。
- 解析失败不吞：YAML、JSON、编码失败都变成 finding。

## 5. 测试

- 全部用 `node:test`，按模块拆文件；fixture 在测试运行时写到 `os.tmpdir()` 的临时目录，**不把故意有问题的文件提交进仓库**（否则自检会打自己）。
- 重点用例：
  - walker：published/ignored/pruned 三集合、裁剪目录不被遍历、`node_modules` 未忽略时 REPO002 命中、被忽略目录内的文件不出现；
  - gitignore：锚定、目录、`**`、取反、嵌套忽略、被忽略目录内的取反行为；
  - 文本分类：UTF-8、UTF-8 BOM、UTF-16、GBK 字节、二进制；
  - import 抽取：注释/字符串里的伪 import、动态 import、`node:` 前缀、多行 import；
  - 解析：相对缺失、裸包缺失、`file:` 依赖、包外相对路径；
  - 规则：每条规则至少一正一反（含 WALK/CFG/DISCOVER）；
  - waiver：命中后不计入 counts、JSON 有 waived 计数、CFG004 能报未命中 waiver；
  - 引擎：临时包树端到端，`blocked` / `publishable`、配置改级、`ignore` 生效、报告文件生成、截断后 verdict 不变；
  - CLI：`runCli` 退出码与 `--json` 输出；
  - 发现：嵌套包、非插件目录、深度限制、根配置的 depth 生效。
- 测试里构造绝对路径字面量时用运行时拼接（如 `winPath()` 辅助函数），避免源码命中 PAT001 造成自检噪音；确实需要字面量的规则模式表用 waiver。

## 6. 验收

1. `node --test test/` 全绿。
2. `node bin/plugin-lint.mjs . --json`：本插件自身 `verdict: "publishable"`、0 error；waiver 只用于 `lib/rules/patterns.mjs` 且报告里能看到 waived 数。
3. 对 `D:\OPCG\plugins\dsh-opcg-tickets`：blocked，命中 SEC001 与缺 LICENSE/.gitignore。
4. 对 `D:\OPCG\plugins\dsh-opcg-cards`：blocked，命中 PAT001（`D:\OPCG\data\cards.json` 等）。
5. `plugin_manager install_bundle` 后工具 `plugin_lint` 可用；一次工作区扫描能发现并检查多个包。
6. 报告对命中密钥只显示打码片段。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| YAML 子集解析器覆盖不到复杂补丁 | 只支持 DSH 补丁方言（sequence-of-maps、insert、flow `{}`/`[]`、标量、注释、`!!js` 标签）；遇到不支持结构报 PATCH001 并附原行，不静默通过；用真实补丁做回归用例 |
| gitignore 语义细节偏差 | 按 git 文档实现并在测试里固定行为；被忽略目录不可取反这一点与 git 保持一致 |
| 文档示例路径误报 | 占位符分类降级为 info；可用 `rules` / `ignore` 覆盖 |
| 规则模式串自匹配 | 模式集中到 `lib/rules/patterns.mjs`，用带 reason 的 waiver 显式豁免；报告列出 waived 数，不用全局 ignore 留白 |
| 依赖解析依赖本机 `node_modules` 是否安装 | 解析失败按真实语义报 error 并提示「先安装依赖或补齐声明」；报告写明解析基目录 |
| 语法检查调子进程失败或超时 | 降级为 SYN002 info，并明确写「语法未检查」，不冒充通过 |
| 无参调用扫错目录 | 默认取会话工作区，取不到用 cwd；0 候选报 DISCOVER001 并要求显式传参，不猜 |

## 8. 作者裁决（builder check 后）

| 问题 | 裁决 |
|---|---|
| walker 是否把被忽略文件交给规则 | 拆 `published` / `ignoredFiles` / `prunedDirs` 三集合；REPO002 改为「存在 node_modules 且未被忽略」；SEC003 只看显式忽略的文件 |
| skip/截断/配置错误没有规则 id | 全部升为正式规则（WALK/CFG/DISCOVER），进注册表、可配置、进 JSON；顶层问题放报告顶层 `findings` |
| 语法检查拖垮 3 秒预算 | 3 秒不含语法检查；语法默认开、并发 4、上限 300 文件，超出记 SYN002 |
| files/exports 防什么事故 | 防「发布后装不上/一跑就坏」；按 Node 语义支持字符串 exports、子路径、通配与 main；PKG010 扩到所有入口可达的运行时文件 |
| SEC001 与示例文件冲突 | `*.example.*` / `.env.example` 走 SEC003 info，不阻断；hint 同步改口径 |
| 规则模式串自匹配 | 集中到 patterns.mjs + 带 reason 的 waiver；报告显示 waived，不静默 |
| discovery 配置来源 | 只在扫描根配置 + CLI/工具参数；包级 discovery 报 CFG004 |
| 工具默认目录 | 会话工作区优先，cwd 兜底，0 候选报 DISCOVER001 并要求显式传参 |

## 9. 留给实现者

- 文件拆分的具体粒度（本设计的模块划分为建议，不强制）。
- 报告文案、图标设计、检查单的具体措辞。
- 规则的实现顺序与测试组织。
- 会话工作区 API 的具体取法（以 `cordis_inspect` 结果为准；拿不到就走 cwd 兜底）。
