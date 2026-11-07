# dsh-plugin-lint

插件发布前自检：把「本机能跑」和「能直接传 GitHub」之间的差距一次列清楚。

它只读、不改文件。扫完给一份 error / warn / info 三级报告，最后回答一个问题：**这个包现在能不能发**。

## 检查范围

| 检查单 | 看什么 |
| --- | --- |
| 清单与入口完整 | package.json 必填字段、exports 指向、files 白名单、入口可达文件 |
| 补丁与注册 | cordis.patch.yml 能否解析、条目 id/name、名称能否解析 |
| 路径可移植 | 源码/测试/文档里的盘符路径、UNC、家目录、file URL |
| 编码统一 | 非法 UTF-8（GBK 写出）、UTF-8 BOM、UTF-16/32、乱码标记、shebang CRLF |
| 依赖完整 | 相对导入、裸包导入、未声明依赖、runtime 引 devDependencies、逃出包根的导入 |
| 无凭证泄露 | 凭证文件、私钥块、平台 token、明文密码；输出打码 |
| 仓库卫生 | .gitignore、node_modules 未忽略、大文件、缓存目录 |
| 文档与展示 | README、LICENSE、icon、locale 的 meta 与 exports |
| 语法可加载 | `node --check`（可关；沙箱不能 spawn 时降级为 info） |
| 配置与豁免 | .pluginlint.json 非法字段、未知规则、无效 waiver、扫描截断 |

扫描默认尊重 `.gitignore`；`node_modules`、`.git`、虚拟环境、缓存目录不会进入（只记一条 pruned 状态）。二进制按内容识别，不按扩展名。

## 安装

本目录是一个 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，安装后注册 `plugin_lint` 工具。用你惯用的 DSH 插件安装方式安装本目录即可。

## 命令行

```bash
node bin/plugin-lint.mjs .                       # 检查当前插件包
node bin/plugin-lint.mjs ../my-plugin --json     # 输出 JSON
node bin/plugin-lint.mjs --root .. --depth 2     # 自动发现工作区里的插件包
node bin/plugin-lint.mjs . --out reports         # 同时写 Markdown 与 JSON
```

| 参数 | 说明 |
| --- | --- |
| `[dirs...]` | 一个或多个插件目录 |
| `--root <dir>` | 工作区根，自动发现插件包；与位置参数互斥 |
| `--depth <n>` | 发现深度，默认 3 |
| `--json` | 输出 JSON |
| `--out <dir>` | 写 `plugin-lint-report.md` 与 `plugin-lint-report.json` |
| `--fail-on <level>` | `error`（默认）/ `warn` / `info` / `none` |
| `--no-syntax` | 跳过语法检查 |
| `--quiet` | 只打印结论行 |
| `--help` | 用法 |

退出码：`0` 可发，`1` 阻断，`2` 参数或运行失败。`--fail-on` 只影响退出码与结论，不改变 finding 的级别。

## DSH 工具

```json
{
  "dir": "某个插件目录",
  "root": "工作区根（与 dir 二选一）",
  "depth": 3,
  "detail": false,
  "json": false,
  "out": "报告目录",
  "syntax": true,
  "limit": 20
}
```

不传 `dir`/`root` 时以 `DSH_WORKSPACE` 或当前目录为根；一个插件包也没发现时报告 `DISCOVER001`，请在参数里显式给目录。

## 配置

在扫描根或插件包根放 `.pluginlint.json`：

```json
{
  "ignore": ["fixtures/**"],
  "rules": { "ENC002": "off", "REPO003": "warn" },
  "waivers": [
    {
      "file": "lib/rules/patterns.mjs",
      "rules": ["PAT001", "SEC002", "ENC004"],
      "reason": "规则特征表本身就是检测样本，不是被检内容"
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

- `ignore` 用 gitignore 语法，目录以 `/` 结尾。
- `rules` 可把规则调成 `off` / `info` / `warn` / `error`。
- `waiver` 必须写 `file`、`rules`、`reason`；只豁免精确匹配的文件与规则，不做目录级大赦。未命中的 waiver 会报 `CFG004`。
- 包级配置只影响该包；`discovery` 只在扫描根的配置里生效。

## 规则表

### 清单与补丁

| ID | 级别 | 说明 |
| --- | --- | --- |
| PKG001 | error | package.json 缺失或 JSON 非法 |
| PKG002 | error | name 非法或超过 214 字符 |
| PKG003 | error | version 不是 semver |
| PKG004 | warn | 缺 description |
| PKG005 | warn | 缺 license |
| PKG006 | warn | 缺 `type: module` |
| PKG007 | error | exports 指向的文件不存在 |
| PKG008 | warn | 缺 `dsh.bundle.patch` |
| PKG009 | warn | files 条目没有对应文件 |
| PKG010 | error | 入口可达的运行时文件不在 files 白名单 |
| PKG011 | error | dsh.bundle.patch 指向的文件不存在 |
| PKG012 | error | 没有 `type: module` 的 .js 里用了 ESM |
| PKG013 | warn | dependencies 里出现 `file:` / `link:` |
| PATCH001 | error | cordis 补丁 YAML 解析失败 |
| PATCH002 | error | 补丁没有任何条目 |
| PATCH003 | error | 补丁条目缺 id 或 name |
| PATCH004 | warn | 补丁条目 id 重复 |
| PATCH005 | warn | 补丁里的 name 无法从包根解析 |

### 路径与编码

| ID | 级别 | 说明 |
| --- | --- | --- |
| PAT001 | runtime error / test warn / docs info | 文本里出现本机绝对路径；示例占位符降为 info |
| ENC001 | error | 不是合法 UTF-8（GBK/ANSI 写出） |
| ENC002 | warn | 文件带 UTF-8 BOM |
| ENC003 | error | 文件是 UTF-16/UTF-32 |
| ENC004 | warn | 合法 UTF-8 里出现乱码标记 |
| ENC005 | warn | 带 shebang 的文件使用 CRLF |

### 依赖

| ID | 级别 | 说明 |
| --- | --- | --- |
| DEP001 | error | 相对导入解析失败 |
| DEP002 | error | 裸包导入解析失败 |
| DEP003 | warn | 能解析但没写进依赖 |
| DEP004 | error | runtime 文件引用 devDependencies |
| DEP005 | error | 相对导入逃出包根 |
| DEP006 | info | 动态 import/require 参数不是字面量，无法静态验证 |

### 凭证与仓库

| ID | 级别 | 说明 |
| --- | --- | --- |
| SEC001 | error | 发布集合里包含凭证文件 |
| SEC002 | runtime/docs error / test warn | 文本里疑似私钥、平台 token、明文密码；值打码 |
| SEC003 | info | 被忽略的凭证文件，或示例凭证文件 |
| REPO001 | warn | 没有 .gitignore |
| REPO002 | error | node_modules 存在且没被忽略 |
| REPO003 | warn | 文件超过大文件警告阈值 |
| REPO004 | error | 文件超过大文件阻断阈值 |
| REPO005 | info | 虚拟环境/缓存目录没被忽略 |

### 文档与展示

| ID | 级别 | 说明 |
| --- | --- | --- |
| DOC001 | warn | 缺 README.md |
| DOC002 | warn | 清单有 license 但缺 LICENSE 文件 |
| DSP001 | error | exports 的 icon 或顶层 icon 指向不存在的文件 |
| DSP002 | warn | 图标扩展名不支持或超过 256 KiB |
| DSP003 | error | locale JSON 解析失败或顶层不是对象 |
| DSP004 | warn | locale 缺 meta.title / meta.description |
| DSP005 | warn | 有 locale 但 exports 没有 `./locale/*.json` |

### 语法与元信息

| ID | 级别 | 说明 |
| --- | --- | --- |
| SYN001 | error | `node --check` 失败 |
| SYN002 | info | 语法未检查（沙箱不能 spawn、超出文件上限、非 ESM 的 .js 等） |
| WALK001 | info | 超过 maxFileBytes 的文件未做内容扫描 |
| WALK002 | info | 文件数达到 maxFiles，扫描被截断 |
| WALK003 | info | findings 超过 maxFindings，报告被截断 |
| WALK004 | warn | 文件读取失败 |
| CFG001 | error | .pluginlint.json JSON 非法 |
| CFG002 | info | 配置里有未知字段或类型不对 |
| CFG003 | warn | 引用了未知规则或未知级别 |
| CFG004 | warn | waiver 无效，或没有命中任何 finding |
| DISCOVER001 | info | root 模式一个插件包也没发现 |

## 豁免政策

豁免只用于「检测器本身」：模式表、特征表、测试里故意构造的坏样本。业务代码里的绝对路径、GBK 文件、真实密钥不能靠 waiver 过关——那等于把自检关掉。

## 已知限制

- 语法检查需要子进程。某些沙箱会禁止 spawn，此时降级为 `SYN002` info，不影响其余检查。
- 依赖解析只覆盖 Node 风格的静态 `import` / `export from` / `require`；动态拼接的路径只能报 `DEP006`。
- 二进制按内容识别；真正的二进制文件不做编码与密钥扫描。
- 不自动修改文件。编码问题请用配套的 encoding-repair 工具处理。

## 开发

零运行时依赖，Node.js ≥ 20。

```bash
node test/gitignore.test.mjs
node test/walk.test.mjs
# …逐个跑；某些沙箱里 `node --test test/` 会因 spawn EPERM 失败
```

## License

MIT
