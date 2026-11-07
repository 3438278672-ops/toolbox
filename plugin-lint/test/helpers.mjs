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
