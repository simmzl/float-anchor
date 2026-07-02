import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/fa.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
})
console.log('built dist/fa.js')
