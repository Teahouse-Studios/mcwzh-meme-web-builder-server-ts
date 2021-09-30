import Koa from 'koa'
import Router from '@koa/router'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { readdirSync } from 'fs'
import { MemepackBuilder, ModuleChecker } from 'memepack-builder'
import cors from '@koa/cors'
import koaBody from 'koa-body'
import unparsed from 'koa-body/unparsed.js'
import crypto from 'crypto'
const Minio = require('minio')
import { exec } from 'child_process'
import { promisify } from 'util'
require('dotenv').config({ path: resolve(__dirname, process.env.NODE_ENV === 'production' ? '../.env.production' : '../.env') })

const execPromise = promisify(exec)

const app = new Koa()
const router = new Router()
app.use(cors())
app.use(koaBody({
  includeUnparsed: true
}))

const client = new Minio.Client({
  endPoint: `${process.env.S3_REGION}.aliyuncs.com`,
  accessKey:  process.env.S3_KEYID,
  secretKey: process.env.S3_SECRET,
  pathStyle: false,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET
})

const root = process.env.NODE_ENV === 'production' ? '/mnt/meme/' : resolve(__dirname, '..', 'data')

const jePath = resolve(root, 'mcwzh-meme-resourcepack')
const bePath = resolve(root, 'mcwzh-meme-resourcepack-bedrock')

const je = new MemepackBuilder('je', resolve(jePath, 'meme_resourcepack'), resolve(jePath, 'modules'))
const be = new MemepackBuilder('be', resolve(bePath, 'meme_resourcepack'), resolve(jePath, 'modules'))

const jeModules = new ModuleChecker(resolve(jePath, 'modules'))
const beModules = new ModuleChecker( resolve(bePath, 'modules'))

app.use(async (ctx, next) => {
  try {
    await next()
  }
  catch (e) {
    console.error(e)
    ctx.status = 500
    ctx.body = {
      logs: e.stack
    }
  }
})
router.get('/', async (ctx) => {
  try {
    let mods = (await readdirSync(resolve(jePath, 'mods'))).map(v => `mods/${v}`)
    let enmods = (await readdirSync(resolve(jePath, 'en-mods'))).map(v => `en-mods/${v}`)
    ctx.body = {
      mods, enmods,
      je_modules: (await jeModules.moduleInfo()).modules,
      be_modules: (await beModules.moduleInfo()).modules,
      je_modified: 0,
      be_modified: 0,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      message: e.stack
    }
  }
})

process.on('uncaughtException', (e) => {
  console.log(e)
});

router.post('/ajax', async (ctx) => {
  const { type, modules, mod, sfw, format, compatible } = ctx.request.body
  const _be = Boolean(ctx.request.body._be);
  const builder = _be ? be : je
  builder.options = {
    type, modules, mod, sfw, format, hash: true,
    compatible,
    outputDir: tmpdir()
  }
  try {
    let r = await builder.build(true)
    let exist = true
    try {
      const head = await client.statObject(process.env.S3_BUCKET, r.name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      console.log('not exist, reupload')
      await client.putObject(process.env.S3_BUCKET, r.name, r.buf)
    }
    ctx.body = {
      logs: builder.log.join('\n'),
      filename: r.name,
      root: process.env.S3_ROOT
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs: e.stack + '\n' + builder.log.join('\n')
    }
  }
})

router.post('/github/', async (ctx) => {
  const sigHeaderName = 'x-hub-signature-256'
  const remoteSig = Buffer.from(ctx.headers[sigHeaderName].toString())
  const hmac = crypto.createHmac('sha256', process.env.GH_WEBHOOK_SECRET)
  const digest = Buffer.from('sha256=' + hmac.update(ctx.request.body[unparsed]).digest('hex'), 'utf-8')
  if (remoteSig.length !== digest.length || !crypto.timingSafeEqual(digest, remoteSig)) {
    console.log(`remote ${remoteSig}, local ${digest}`)
    if (process.env.NODE_ENV === 'production') {
      return ctx.status = 403
    }
  }
  const dir = ctx.request.body.repository.name === "mcwzh-meme-resourcepack" ? jePath : bePath
  let result = ""
  let r = await execPromise(`git checkout master`, { cwd: dir })
  result += "\n" + r.stdout
  r = await execPromise(`git pull`, { cwd: dir })
  result += "\n" + r.stdout
  ctx.body = {
    stdout: result,
    dir
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

const server = app.listen(~~process.env.FC_SERVER_PORT || 8000)
server.timeout = 0
server.keepAliveTimeout = 0