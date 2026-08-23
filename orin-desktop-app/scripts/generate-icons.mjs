// Renders the amber bolt SVG into the icon set Tauri expects
// (icons/*.png + icons/orin.ico) via @tauri-apps/cli icon.
import { Resvg } from '@resvg/resvg-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const svgPath = join(root, 'assets', 'orin-mark.svg')
const outDir = join(root, 'src-tauri', 'icons')

mkdirSync(outDir, { recursive: true })

const svg = readFileSync(svgPath, 'utf8')
const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: 'rgba(0,0,0,0)',
}).render().asPng()

const source = join(root, 'dist-icon-source.png')
writeFileSync(source, png)

execFileSync('npx', ['@tauri-apps/cli', 'icon', source, '--output', outDir], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

console.log('Icons generated in src-tauri/icons')
