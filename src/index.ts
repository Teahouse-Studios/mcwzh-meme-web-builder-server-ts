import Koa from 'koa'
import Router from '@koa/router'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { readdirSync } from 'fs'
import { MemepackBuilder } from 'memepack-builder'
import cors from '@koa/cors'
import koaBody from 'koa-body'

const app = new Koa()
const router = new Router()
app.use(cors())
app.use(koaBody())


const root = process.env.NODE_ENV === 'production' ? '/mnt/meme/' : resolve(__dirname, '..', 'data')

const jePath = resolve(root, 'mcwzh-meme-resourcepack')
const bePath = resolve(root, 'mcwzh - meme - resourcepack - bedrock')

const je = new MemepackBuilder('je', resolve(jePath, 'meme_resourcepack'), resolve(jePath, 'modules'))
const be = new MemepackBuilder('be', resolve(bePath, 'meme_resourcepack'), resolve(jePath, 'modules'))

router.get('/', async (ctx) => {
  try {
    let mods = (await readdirSync(resolve(jePath, 'mods'))).map(v => `mods/${v}`)
    let enmods = (await readdirSync(resolve(jePath, 'en-mods'))).map(v => `en-mods/${v}`)
    ctx.body = {
      mods, enmods,
      je_modules: je.moduleChecker.moduleInfo().modules,
      be_modules: be.moduleChecker.moduleInfo().modules,
      je_modified: 0,
      be_modified: 0
    }
  } catch (e) {
    ctx.status = 403
    ctx.body = {
      message: e.stack
    }
  }
})

router.post('/ajax', async (ctx) => {
  const { type, modules, mod, sfw, format, compatible } = ctx.request.body
  const _be = Boolean(ctx.request.body._be);
  const builder = _be ? be : je
  builder.builder.options = {
    type, modules, mod, sfw, format, hash: true,
    compatible,
    outputDir: tmpdir()
  }
  try {
    let r = await builder.build(true)
    ctx.body = {
      logs: builder.log.join('\n'),
      filename: r.name
    }
  } catch (e) {
    ctx.status = 403
    ctx.body = {
      logs: e.message + '\n' + builder.log.join('\n')
    }
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

const server = app.listen(9000)
server.timeout = 0
server.keepAliveTimeout = 0