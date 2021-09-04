import Koa from 'koa'
import Router from '@koa/router'
import { resolve } from 'path'
import { readdir } from 'fs/promises'
import { MemepackBuilder } from 'memepack-builder'
import cors from '@koa/cors'

const app = new Koa()
const router = new Router()
app.use(cors())

const jePath = resolve(__dirname, '..', 'data', 'mcwzh-meme-resourcepack')
const bePath = resolve(__dirname, '..', 'data', 'mcwzh-meme-resourcepack-bedrock')

const je = new MemepackBuilder('je', resolve(jePath, 'meme_resourcepack'), resolve(jePath, 'modules'))
const be = new MemepackBuilder('be', resolve(bePath, 'meme_resourcepack'), resolve(jePath, 'modules'))

router.get('/', async (ctx) => {
  let mods = (await readdir(resolve(jePath, 'mods'))).map(v => `mods/${v}`)
  let enmods = (await readdir(resolve(jePath, 'en-mods'))).map(v => `en-mods/${v}`)
  ctx.body = {
    mods, enmods,
    je_modules: je.moduleChecker.moduleInfo().modules,
    be_modules: be.moduleChecker.moduleInfo().modules,
    je_modified: 0,
    be_modified: 0
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

app.listen(8000)