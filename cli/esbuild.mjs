import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/fa.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // commander 是 CJS 包，esbuild 打成 esm 后其内部 require('node:events') 等调用
  // 找不到全局 require；注入 createRequire 垫片供 esbuild 的 __require 兜底逻辑使用。
  banner: { js: "import { createRequire as __faCreateRequire } from 'node:module';\nconst require = __faCreateRequire(import.meta.url);" },
})
console.log('built dist/fa.js')
