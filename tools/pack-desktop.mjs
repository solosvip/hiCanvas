import { build } from 'esbuild'
import { packager } from '@electron/packager'
import { cp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const stage = join(root, 'build', 'desktop-stage')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await mkdir(join(stage, 'runtime'), { recursive: true })
await mkdir(join(stage, 'desktop'), { recursive: true })
// 所有服务端依赖打入应用；仅 Node 内建模块与 Electron 保持外部引用。
for (const [entry, output] of [['desktop/main.mjs', 'desktop/main.mjs'], ['bin/hicanvas-service.mjs', 'runtime/service.mjs'], ['bin/hicanvas-mcp.mjs', 'runtime/mcp.mjs']]) {
  await build({ entryPoints: [join(root, entry)], outfile: join(stage, output), bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } })
}
await cp(join(root, 'dist'), join(stage, 'dist'), { recursive: true })
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'))
await cp(join(root, 'licenses'), join(stage, 'licenses'), { recursive: true })
await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'hicanvas', productName: 'hiCanvas', version: pkg.version, private: true, type: 'module', main: 'desktop/main.mjs', description: pkg.description }))
if (process.argv.includes('--bundle-only')) { console.log(stage); process.exit(0) }
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('当前安装包仅支持 Apple 芯片 Mac。')
const identity = process.env.HICANVAS_SIGN_IDENTITY || 'Developer ID Application: Feng Shu (5QS2RDW5AK)'
const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
if (!identities.includes(`"${identity}"`)) throw new Error('找不到指定 Developer ID 签名，未生成未签名安装包。')
const paths = await packager({ dir: stage, out: join(root, 'build', 'desktop'), name: 'hiCanvas', executableName: 'hiCanvas', platform: 'darwin', arch: 'arm64', electronVersion: pkg.devDependencies.electron, appBundleId: 'com.suxingxing.hicanvas', appCategoryType: 'public.app-category.graphics-design', appVersion: pkg.version, overwrite: true, asar: true, prune: false, icon: join(root, 'build', 'hiCanvas.icns'), extendInfo: { CFBundleURLTypes: [{ CFBundleURLName: 'hiCanvas canvas', CFBundleURLSchemes: ['hicanvas'] }], NSHighResolutionCapable: true }, osxSign: { identity, hardenedRuntime: true, optionsForFile: () => ({ entitlements: join(root, 'desktop', 'entitlements.plist') }) } })
for (const path of paths) {
  const app = join(path, 'hiCanvas.app')
  const launcher = join(app, 'Contents', 'Resources', 'hicanvas-mcp')
  await writeFile(launcher, `#!/bin/sh\nHICANVAS_RESOURCES_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexport HICANVAS_APP_ROOT="$HICANVAS_RESOURCES_DIR/app.asar"\nexport HICANVAS_DESKTOP_APP="$HICANVAS_RESOURCES_DIR/../.."\nexport ELECTRON_RUN_AS_NODE=1\nexec "$HICANVAS_RESOURCES_DIR/../MacOS/hiCanvas" "$HICANVAS_APP_ROOT/runtime/mcp.mjs" "$@"\n`)
  await chmod(launcher, 0o755)
  // 启动器在 Resources 中，加入后重新封签主 bundle。
  execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', '--entitlements', join(root, 'desktop', 'entitlements.plist'), app])
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  const zip = resolve(root, 'build', `hiCanvas-${pkg.version}-mac-arm64.zip`)
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip])
  console.log(`应用：${app}\n压缩包：${zip}`)
}
