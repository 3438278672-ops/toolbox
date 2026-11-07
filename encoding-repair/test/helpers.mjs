import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function makeTempDir(prefix = 'encoding-repair-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'))
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }
}

export function pluginManifest(name = 'dsh-encoding-demo') {
  return JSON.stringify(
    {
      name,
      version: '0.1.0',
      type: 'module',
      description: 'encoding repair fixture',
      license: 'MIT',
      exports: { '.': './index.js' },
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    },
    null,
    2,
  )
}

export async function makePlugin(prefix, extra = {}) {
  const root = await makeTempDir(prefix)
  await writeFiles(root, {
    'package.json': pluginManifest(),
    'cordis.patch.yml': '- insert:\n    - id: encoding-demo\n      name: dsh-encoding-demo\n      config: {}\n',
    'index.js': 'export const name = "dsh-encoding-demo"\n',
    'README.md': '# demo\n',
    LICENSE: 'MIT\n',
    '.gitignore': 'node_modules/\nignored.txt\n',
    ...extra,
  })
  return root
}

export const GBK_CN_TEST = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])
export const BIG5_CN_TEST = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5, 0xb4, 0xfa, 0xb8, 0xd5])

export function utf16leBom(text) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
}

export function utf16beBom(text) {
  const le = Buffer.from(text, 'utf16le')
  const be = Buffer.allocUnsafe(le.length)
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]
    be[i + 1] = le[i]
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), be])
}

export function utf32leBom(text) {
  const parts = [Buffer.from([0xff, 0xfe, 0x00, 0x00])]
  for (const ch of text) {
    const buf = Buffer.allocUnsafe(4)
    buf.writeUInt32LE(ch.codePointAt(0), 0)
    parts.push(buf)
  }
  return Buffer.concat(parts)
}

export async function readBuffer(file) {
  return fsp.readFile(file)
}
