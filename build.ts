import { build } from 'esbuild'
import fs from 'fs'

async function b(){
    await build({
        entryPoints: ['./src/index.ts'],
        outfile: './dist/index.js',
        bundle: true,
        platform: 'node',
        target: 'node16',
        sourcemap: 'inline'
    })
    fs.copyFileSync('./bootstrap', './dist/bootstrap')
    fs.copyFileSync('./.env', './dist/.env')

}

b()