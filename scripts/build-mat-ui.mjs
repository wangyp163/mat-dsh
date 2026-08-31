import { build } from '../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const entry = resolve(root, 'packages/mat-ui/src/client/index.tsx')
const outfile = resolve(root, 'packages/mat-ui/lib/client.js')
const id = resolve(root, 'packages/mat-ui')

await build({
  entryPoints: [entry], outfile, bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic',
  external: [
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-runtime/client',
  ],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
console.log(`built ${outfile}`)
