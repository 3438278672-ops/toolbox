import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function makeTree(t, files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'plugin-lint-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'))
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

export function winPath(...parts) {
  return ['C:', ...parts].join('\\')
}

export function pluginFiles({ manifest = {}, extra = {} } = {}) {
  const base = {
    name: 'dsh-demo',
    version: '0.1.0',
    type: 'module',
    description: 'demo plugin',
    license: 'MIT',
    exports: './index.js',
    files: ['index.js', 'cordis.patch.yml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }
  return {
    'package.json': `${JSON.stringify({ ...base, ...manifest }, null, 2)}\n`,
    'index.js': 'export const answer = 1\n',
    'cordis.patch.yml': '- insert: [{id: demo, name: dsh-demo, config: {}}]\n',
    'README.md': '# demo\n',
    LICENSE: 'MIT\n',
    '.gitignore': 'node_modules/\n',
    ...extra,
  }
}
