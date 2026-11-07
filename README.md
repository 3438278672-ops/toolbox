# toolbox

一些妙妙小工具。

| 目录 | 说明 |
|---|---|
| [`plugin-lint/`](plugin-lint/) | DSH 插件发布前自检：绝对路径、编码、清单、依赖、凭证与发布卫生，输出「可发/不可发」检查单 |
| `encoding-repair/` | 编码修复器（规划中）：把 GBK / UTF-16 / 乱码文件转回 UTF-8，作为 plugin-lint 的配套修复工具 |

每个子目录都是一个独立可安装的 DSH 插件包。

## plugin-lint

发布前自检，只读不改文件：

```bash
node plugin-lint/bin/plugin-lint.mjs plugin-lint
node plugin-lint/bin/plugin-lint.mjs --root . --depth 2
node plugin-lint/bin/plugin-lint.mjs plugin-lint --json --out reports
```

在 DSH 里安装后可直接用 `plugin_lint` 工具（参数 `dir` / `root`）。

| 规则族 | ID | 看什么 |
|---|---|---|
| 清单 | PKG001-013 | package.json 必填字段、exports、files 白名单、入口可达文件 |
| 补丁 | PATCH001-005 | cordis.patch.yml 解析、条目 id/name、名称解析 |
| 路径 | PAT001 | 盘符路径、UNC、家目录、file URL |
| 编码 | ENC001-005 | 非法 UTF-8、BOM、UTF-16/32、乱码、shebang CRLF |
| 依赖 | DEP001-006 | 相对/裸包导入、未声明依赖、devDependencies、逃出包根 |
| 凭证 | SEC001-003 | 凭证文件、密钥特征、被忽略的凭证 |
| 仓库 | REPO001-005 | .gitignore、node_modules、大文件、缓存目录 |
| 展示 | DOC001-002、DSP001-005 | README、LICENSE、icon、locale |
| 语法 | SYN001-002 | `node --check` |
| 元信息 | WALK001-004、CFG001-004、DISCOVER001 | 扫描截断、配置与 waiver、发现结果 |

退出码：`0` 可发、`1` 阻断、`2` 参数或运行失败。配置与豁免见 [`plugin-lint/README.md`](plugin-lint/README.md)。
