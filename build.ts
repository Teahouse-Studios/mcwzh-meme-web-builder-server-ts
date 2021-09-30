import { build } from 'esbuild'

build({
    entryPoints: ['./src/index.ts'],
    outfile: './dist/index.js',
    bundle: true,
    platform: 'node',
    target: 'node16',
    sourcemap: 'inline'
})