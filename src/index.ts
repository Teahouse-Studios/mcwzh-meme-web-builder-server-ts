import Koa from 'koa'
import Router from '@koa/router'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { readdirSync, statSync } from 'fs'
import { MemepackBuilder, ModuleParser } from 'memepack-builder'
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

const je = new MemepackBuilder({ platform: 'je', resourcePath: resolve(jePath, 'meme_resourcepack'), modulePath: resolve(jePath, 'modules') })
const be = new MemepackBuilder({ platform: 'be', resourcePath: resolve(bePath, 'meme_resourcepack'), modulePath: resolve(bePath, 'modules') })

const jeModules = new ModuleParser(resolve(jePath, 'modules'))
const beModules = new ModuleParser(resolve(bePath, 'modules'))

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
  const jeModulesInfo = (await jeModules.moduleInfo()).modules.map(({ languageModification, ...rest }) => ({ ...rest }))
  const beModulesInfo = (await beModules.moduleInfo()).modules.map(({ languageModification, ...rest }) => ({ ...rest }))
  try {
    let mods = (await readdirSync(resolve(jePath, 'mods'))).map(v => `mods/${v}`)
    let enmods = (await readdirSync(resolve(jePath, 'en-mods'))).map(v => `en-mods/${v}`)
    ctx.body = {
      mods, enmods,
      je_modules: {
        resource: jeModulesInfo.filter((i) => { return i.type === 'resource' }),
        collection: jeModulesInfo.filter((i) => { return i.type === 'collection' })
      },
      be_modules: {
        resource: beModulesInfo.filter((i) => { return i.type === 'resource' }),
        collection: beModulesInfo.filter((i) => { return i.type === 'collection' })
      },
      je_modified: statSync(resolve(jePath, '.git/index')).mtime.valueOf(),
      be_modified: statSync(resolve(bePath, '.git/index')).mtime.valueOf()
    }
  } catch (e) {
    console.error(e)
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
  builder.options = {
    type, modules, mod, sfw, format, hash: true,
    compatible,
    outputDir: tmpdir()
  }
  try {
    let r = await builder.build(true)
    let exist = true
    try {
      await client.statObject(process.env.S3_BUCKET, r.name)
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
