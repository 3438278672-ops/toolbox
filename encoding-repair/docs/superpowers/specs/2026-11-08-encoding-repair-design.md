# dsh-encoding-repair 设计

状态：已确认（2026-11-08 用户选定三项默认：dry-run；只扫插件包；只修可证明/可逆的，mojibake 只报告）

## 1. 目标

把 PowerShell / 老工具写坏的中文插件源码转回 UTF-8：

- UTF-16 LE/BE（含 BOM；无 BOM 时只在零字节分布明确时识别）；
- UTF-32 LE/BE（含 BOM）；
- 无 BOM 的 GBK / GB18030（只在字节结构合法、解码可信时转换）；
- UTF-8 BOM（去掉 BOM）；
- 已经是 UTF-8 但含 `U+FFFD` / 常见乱码标记 的二次转码：只报告，不写；
- 疑似 Big5 或 GBK/Big5 难分：只报告，不写。

默认 dry-run。只有 `fix: true`（CLI `--fix`）才写文件，写前在同目录留 `.bak`（重名时 `.bak.1`、`.bak.2`）。不自动改行尾、不加内容、不格式化。

## 2. 分层

```
lib/gitignore.mjs   与 dsh-plugin-lint 同一套 .gitignore 子集（独立打包所以复制）
lib/discover.mjs    包发现：package.json + cordis.patch.yml 或 dsh.bundle.patch
lib/walk.mjs        发布集合遍历：尊重 .gitignore、裁剪 node_modules/.git 等、跳过 .bak
lib/sniff.mjs       纯字节 → {encoding,text,confidence,fixable,reason,mojibake}
lib/repair.mjs      包级编排：读文件、sniff、dry-run/fix、备份、原子写
lib/report.mjs      Markdown / JSON
lib/cli.mjs         runCli(argv, io)，退出码 0/1/2
index.js            DSH 工具 encoding_repair
bin/encoding-repair.mjs
```

## 3. 识别顺序（sniff）

1. UTF-32 BOM（`FF FE 00 00` / `00 00 FE FF`）→ 手动解码，fixable。
2. UTF-8 BOM（`EF BB BF`）→ 去 BOM 后严格 UTF-8，fixable。
3. UTF-16 BOM（`FF FE` / `FE FF`）→ 严格解码，fixable。
4. 无 BOM，严格 UTF-8 成功：
   - 含 `U+FFFD` / 常见乱码标记 → `mojibake: true`，fixable=false；
   - 否则 `utf8`，clean。
5. 无 BOM，严格 UTF-8 失败：
   - 零字节按奇偶位分布 ≥15% 且严格 UTF-16 解码可信 → 无 BOM UTF-16，confidence=medium，fixable；
   - 字节结构合法且 `TextDecoder('gb18030',{fatal:true})` 成功：
     - 若 Big5 也能解，比较 `scoreText()`；Big5 明显更高 → 报 Big5，不修；两者接近 → 报「GBK/Big5 难分」，不修；GBK 明显更高 → GBK，fixable；
     - Big5 不能解 → GBK，fixable；
   - 否则：含大量 NUL/控制字符 → binary；其余 → unknown（只报告）。

`scoreText`：常用汉字权重 3、汉字 0.5、ASCII 0.2，减去控制字符（每 10）与 U+FFFD（每 20）。转换前要求：无 U+FFFD、控制字符不超过 1 个、至少 1 个汉字或可读 ASCII。

## 4. 写回机制

- 只有 `fixable && fix` 才写。
- 备份：`<file>.bak`，已存在则 `<file>.bak.1`、`.bak.2`……；备份是原始字节，用 `wx` 打开避免覆盖。
- 原子写：同目录临时文件 → `rename`；`EPERM/EBUSY` 时退化为原地覆盖（备份已存在），临时文件清理。
- 保留原文件 mode。
- 转换结果：`text` 以 UTF-8 编码，不加 BOM。
- 修复后再跑一次应全部 clean（幂等）。

## 5. 报告与退出码

报告字段：`schemaVersion: 1`、`generatedAt`、`fix`、`packages[]`、`counts`、`errors`。

每个文件条目：`file`、`detected`、`confidence`、`action`（clean / would-fix / fixed / report / skipped / error）、`bytes`、`backup`、`reason`。密钥/内容不进入报告。

CLI 退出码：

- 0：没有需要修的文件；或 `--fix` 且全部修完；
- 1：dry-run 下存在可修文件，或 fix 有失败；
- 2：参数/运行错误。

## 6. 工具与 CLI

工具 `encoding_repair`：`dir` / `root` 互斥，`depth`、`fix`、`json`、`out`、`limit`。默认 `fix=false`；`root` 用与 plugin-lint 相同的发现规则；输出上限 60KB。

CLI：`encoding-repair [dirs...] [--root] [--depth] [--fix] [--json] [--out] [--limit] [--quiet] [--help]`。

## 7. 边界

- 只扫插件包，不处理任意文本目录。
- 不修 Big5、不猜 GBK/Big5 难分、不修 mojibake。
- 不处理 >8 MiB 文件（报告 skipped-large）。
- 不跟随符号链接目录；符号链接文件按 `stat` 结果处理。
- 不自动删除 `.bak`；`.bak` 在后续扫描中跳过。
