import { packageRule } from './util.mjs'

const WARN_BYTES = 5 * 1024 * 1024
const ERROR_BYTES = 50 * 1024 * 1024
const CACHE_DIRS = new Set(['.venv', '__pycache__', '.cache'])

function dirName(rel) {
  return rel.split('/').pop() || rel
}

function published(ctx, rel) {
  return ctx.files.some((file) => file.rel === rel)
}

export const REPO_RULES = [
  packageRule({
    id: 'REPO001',
    category: 'repo',
    checklist: 'repo',
    severity: 'warn',
    run(ctx) {
      if (published(ctx, '.gitignore')) return []
      return [
        {
          message: '没有 .gitignore，node_modules、缓存和凭证文件都可能被提交',
          hint: '加一个 .gitignore，至少包含 node_modules/、.venv/、__pycache__/、*.log。',
        },
      ]
    },
  }),

  packageRule({
    id: 'REPO002',
    category: 'repo',
    checklist: 'repo',
    severity: 'error',
    run(ctx) {
      return ctx.prunedDirs
        .filter((dir) => dirName(dir.rel) === 'node_modules' && !dir.ignored)
        .map((dir) => ({
          file: dir.rel,
          message: `node_modules 目录未被忽略：${dir.rel}`,
          hint: '把 node_modules/ 加入 .gitignore，并确认它没有被提交。',
        }))
    },
  }),

  packageRule({
    id: 'REPO003',
    category: 'repo',
    checklist: 'repo',
    severity: 'warn',
    run(ctx) {
      const limits = ctx.config?.limits ?? {}
      const warnBytes = limits.largeFileWarnBytes ?? WARN_BYTES
      const errorBytes = limits.largeFileErrorBytes ?? ERROR_BYTES
      return ctx.files
        .filter((file) => file.size > warnBytes && file.size <= errorBytes)
        .map((file) => ({
          file: file.rel,
          message: `大文件 ${file.rel}（${Math.round(file.size / 1024)} KiB），不应进发布仓库`,
          hint: '移出仓库、改用构建产物，或把该路径加入 .gitignore。',
        }))
    },
  }),

  packageRule({
    id: 'REPO004',
    category: 'repo',
    checklist: 'repo',
    severity: 'error',
    run(ctx) {
      const limits = ctx.config?.limits ?? {}
      const errorBytes = limits.largeFileErrorBytes ?? ERROR_BYTES
      return ctx.files
        .filter((file) => file.size > errorBytes)
        .map((file) => ({
          file: file.rel,
          message: `超大文件 ${file.rel}（${Math.round(file.size / 1024 / 1024)} MiB），不能进仓库`,
          hint: '移出仓库或加入 .gitignore；如果是误提交，用 git rm --cached 移出索引。',
        }))
    },
  }),

  packageRule({
    id: 'REPO005',
    category: 'repo',
    checklist: 'repo',
    severity: 'info',
    run(ctx) {
      return ctx.prunedDirs
        .filter((dir) => CACHE_DIRS.has(dirName(dir.rel)) && !dir.ignored)
        .map((dir) => ({
          file: dir.rel,
          message: `缓存目录未被忽略：${dir.rel}`,
          hint: '把该目录加入 .gitignore，避免把本机缓存带进仓库。',
        }))
    },
  }),
]
