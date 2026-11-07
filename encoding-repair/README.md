# dsh-encoding-repair

把插件里被 PowerShell / 老工具写坏的中文转回 UTF-8。

它只做一件事：判断文件是什么编码、能不能安全转成 UTF-8；默认只报告，`--fix` 才写回，写前在同目录留 `.bak`。

## 能识别什么

| 输入 | 处理 |
| --- | --- |
| UTF-8 | 不动 |
| UTF-8 BOM | 去掉 BOM（可修） |
| UTF-16 LE / BE（带 BOM） | 转 UTF-8（可修） |
| UTF-16 LE / BE（无 BOM，零字节分布明确） | 转 UTF-8（可修，置信度 medium） |
| UTF-32 LE / BE（带 BOM） | 转 UTF-8（可修） |
| GBK / GB18030（字节结构合法、解码可信） | 转 UTF-8（可修） |
| 疑似 Big5 | 只报告，不转 |
| GBK / Big5 都能解且得分接近 | 只报告，不转 |
| 已是 UTF-8 但含 U+FFFD 等二次转码痕迹 | 只报告，不转 |
| 二进制 / 未识别 | 跳过或只报告 |

判 GBK 时会同时试 Big5；Big5 明显更可信就报 Big5，两者接近就报「难分」，都不写。没有 BOM 的 UTF-16 只在零字节按奇偶位分布足够明确时才认，避免把随机二进制当文本。

## 安全边界

- 只扫插件包：有 `package.json`，并且有 `cordis.patch.yml` 或 `dsh.bundle.patch`。
- 尊重 `.gitignore`；`node_modules`、`.git`、虚拟环境、缓存目录不进入。
- 默认 dry-run；`fix` 才写。
- 写前留 `<file>.bak`；已存在则 `.bak.1`、`.bak.2`。
- 同目录临时文件 + rename；Windows 目标被占用时退化为原地覆盖（备份已存在）。
- 保留原文件权限；不改行尾、不加内容、不格式化。
- 单文件上限 8 MiB，超过只报告跳过。
- 修复是幂等的：再跑一次应该全部干净。

## 安装

本目录是一个 DSH bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，安装后注册 `encoding_repair` 工具。用你惯用的 DSH 插件安装方式安装本目录即可。

## 命令行

```bash
node bin/encoding-repair.mjs .                    # dry-run 当前插件
node bin/encoding-repair.mjs ../my-plugin --fix   # 写回并留 .bak
node bin/encoding-repair.mjs --root .. --depth 2  # 自动发现工作区插件
node bin/encoding-repair.mjs . --json             # JSON
node bin/encoding-repair.mjs . --out reports      # 同时写 Markdown 与 JSON
```

| 参数 | 说明 |
| --- | --- |
| `[dirs...]` | 一个或多个插件目录 |
| `--root <dir>` | 工作区根，自动发现插件包；与位置参数互斥 |
| `--depth <n>` | 发现深度，默认 3 |
| `--fix` | 写回（默认只报告） |
| `--json` | 输出 JSON |
| `--out <dir>` | 写 `encoding-repair-report.md` 与 `.json` |
| `--limit <n>` | 报告最多展示多少条，默认 30 |
| `--quiet` | 只打印结论一行 |
| `--help` | 用法 |

退出码：`0` 没有需要修的文件（或 `--fix` 已全部修完）；`1` dry-run 下有可修文件，或 fix 有失败；`2` 参数或运行失败。

## DSH 工具

```json
{
  "dir": "某个插件目录",
  "root": "工作区根（与 dir 二选一）",
  "depth": 3,
  "fix": false,
  "json": false,
  "out": "报告目录",
  "limit": 30
}
```

不传 `dir`/`root` 时以 `DSH_WORKSPACE` 或当前目录为根。工具默认 dry-run；确认报告后再传 `fix: true`。

## 为什么不做自动猜测

二次转码（例如 UTF-8 被当成 Latin-1 再存一次）和 GBK/Big5 混淆在字节层面都可能「看起来像文本」，但没有可靠的可逆证据。自动改会把正常内容永久写坏，所以这两类只报告，交给人确认。

## 开发

```bash
node test/sniff.test.mjs
node test/repair.test.mjs
node test/cli.test.mjs
```

本机沙箱里 `node --test test/` 可能因为子进程 `spawn EPERM` 失败；逐个跑测试文件即可。
