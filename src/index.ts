import Koa from 'koa'
import Router from '@koa/router'
import axios from 'axios'
import { resolve } from 'path'
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import {
  BedrockPackBuilder,
  JavaPackBuilder,
  ModuleParser
} from 'memepack-builder'
import cors from '@koa/cors'
import koaBody from 'koa-body'
import unparsed from 'koa-body/lib/unparsed'
import crypto from 'crypto'
const Minio = require('minio')
import { exec } from 'child_process'
import { promisify } from 'util'
require('dotenv').config({
  path: resolve(
    __dirname,
    process.env.NODE_ENV === 'production' ? './.env' : '../.env'
  ),
})

const execPromise = promisify(exec)

const app = new Koa()
const router = new Router()
app.use(cors())
app.use(
  koaBody({
    includeUnparsed: true,
  })
)

const hashIt = (data: Buffer) => {
  const a = crypto.createHash('sha256')
  return a.update(data).digest('hex')
}

const client = new Minio.Client({
  endPoint: `${process.env.S3_REGION}.aliyuncs.com`,
  accessKey: process.env.S3_KEYID,
  secretKey: process.env.S3_SECRET,
  pathStyle: false,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET,
})

const root = resolve(__dirname, '..', 'data')

const jePath = resolve(root, 'mcwzh-meme-resourcepack')
const bePath = resolve(root, 'mcwzh-meme-resourcepack-bedrock')

const jeModules = new ModuleParser()
jeModules.addSearchPaths(resolve(jePath, 'modules'))
const beModules = new ModuleParser()
beModules.addSearchPaths(resolve(bePath, 'modules'))

app.use(async (ctx, next) => {
  try {
    await next()
  } catch (e) {
    console.error(e)
    ctx.status = 500
    ctx.body = {
      logs: e.stack,
    }
  }
})

router.get('/v2/modules', async (ctx) => {
  const jeModulesInfo = (await jeModules.searchModules())
  const beModulesInfo = (await beModules.searchModules())
  try {
    let mods = (await readdirSync(resolve(jePath, 'mods'))).map(
      (v) => `mods/${v}`
    )
    let enmods = (await readdirSync(resolve(jePath, 'en-mods'))).map(
      (v) => `en-mods/${v}`
    )
    ctx.body = {
      warning: {},
      mods,
      enmods,
      je_modules: {
        resource: jeModulesInfo.filter((i) => {
          return i.manifest.type === 'resource'
        }).map(v => v.manifest),
        collection: jeModulesInfo.filter((i) => {
          return i.manifest.type === 'collection'
        }).map(v => v.manifest),
      },
      be_modules: {
        resource: beModulesInfo.filter((i) => {
          return i.manifest.type === 'resource'
        }).map(v => v.manifest),
        collection: beModulesInfo.filter((i) => {
          return i.manifest.type === 'collection'
        }).map(v => v.manifest),
      },
      je_modified: statSync(resolve(jePath, '.git/index')).mtime.valueOf(),
      be_modified: statSync(resolve(bePath, '.git/index')).mtime.valueOf(),
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      message: e.stack,
    }
  }
})


function createLegacyMapping() {
  let files = readdirSync(resolve(jePath, 'mappings')).filter(v => v.endsWith(".json"))
  let obj = {}
  for (const filename of files) {
    let data = JSON.parse(readFileSync(resolve(jePath, 'mappings', filename)).toString())
    obj = { ...obj, ...data }
  }
  writeFileSync(resolve(__dirname, '../mapping.json'), JSON.stringify(obj))
}

createLegacyMapping()

router.post('/v2/build/java', async (ctx) => {
  let {
    type,
    modules,
    format,
    mods,
  } = ctx.request.body as unknown as {
    format: number
    mods: string[]
    modules: {
      collection: string[]
      resource: string[]
    }
    type: string
  }

  const mod = mods.map((v) => resolve(jePath, v))
  const log = []


  const builder = new JavaPackBuilder(
    await jeModules.searchModules(),
    resolve(jePath, 'modules', 'priority.txt'),
    resolve(__dirname, '../mapping.json')
  )
  modules = {
    collection: modules.collection,
    resource: ['meme_resourcepack', ...modules.resource]
  }
  try {
    log.push(`Received request with options:
    Platform: Java
    Target type: ${type} ${{
        normal: '',
        compatible: '(uses zh_cn.json instead)',
        legacy:
          '(applies mapping, converts to .lang and uses zh_cn.lang instead)',
      }[type]
      }
    Enabled resource modules: ${modules.resource.join(', ')}
    Enabled collection modules: ${modules.collection.join(', ')}
    ${mod.length > 0 && `Enabled mods: ${mods.join(', ')}`}
    Output file format: .zip
    `)
    const r = await builder.build({
      type: type === 'legacy' ? 'legacy' : 'normal',
      modules,
      mod,
      format,
      hash: true,
      compatible: type === 'compatible',
      platform: 'java',
    })
    const hash = hashIt(r)
    let exist = true
    const name =
      'meme.teahouse.team-' +
      hash.substring(0, 6) +
      (type === 'mcpack' ? '.mcpack' : '.zip')
    try {
      await client.statObject(process.env.S3_BUCKET, name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      log.push('Uploading file to Bucket...')
      await client.putObject(process.env.S3_BUCKET, name, r)
    }

    const warnings = []
    log.push(
      `Built ${name} ${warnings.length > 0
        ? `with ${warnings.length} warning(s)`
        : 'successfully'
      }.`
    )
    ctx.body = {
      logs: log.join('\n'),
      filename: name,
      root: process.env.S3_ROOT,
      checksum: hash,
      size: r.length,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs: e.toString() + '\n' + log.join('\n'),
    }
  }
})

router.post('/v2/build/bedrock', async (ctx) => {
  let { type = 'normal', modules = [], extension = 'zip' } = ctx.request.body

  const builder = new BedrockPackBuilder(
    await beModules.searchModules(),
    resolve(bePath, 'modules', 'priority.txt')
  )
  modules = {
    collection: modules.collection,
    resource: ['meme_resourcepack', ...modules.resource]
  }
  const log = []
  try {
    log.push(`Received request with options:
    Platform: Bedrock
    Target type: ${type} ${{
        normal: '',
        compatible: '(uses zh_cn.lang instead)',
      }[type]
      }
    Enabled resource modules: ${modules.resource.join(', ')}
    Enabled collection modules: ${modules.collection.join(', ')}
    Output file format: .${extension}
    `)
    let r = await builder.build({
      type: 'normal',
      modules,
      hash: true,
      compatible: type === 'compatible',
      platform: 'bedrock',
    })
    const hash = hashIt(r)
    let exist = true
    const name =
      'meme.teahouse.team-' +
      hash.substring(0, 6) +
      (extension === 'mcpack' ? '.mcpack' : '.zip')
    try {
      await client.statObject(process.env.S3_BUCKET, name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      log.push('Uploading file to Bucket...')
      await client.putObject(process.env.S3_BUCKET, name, r)
    }
    log.push(`Built ${name} successfully.`)
    ctx.body = {
      logs: log.join('\n'),
      filename: name,
      root: process.env.S3_ROOT,
      checksum: hash,
      size: r.length,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs: e.toString() + '\n' + log.join('\n'),
    }
  }
})

router.post('/github/', async (ctx) => {
  const sigHeaderName = 'x-hub-signature-256'
  const remoteSig = Buffer.from(ctx.headers[sigHeaderName].toString())
  const hmac = crypto.createHmac('sha256', process.env.GH_WEBHOOK_SECRET)
  const digest = Buffer.from(
    'sha256=' + hmac.update(ctx.request.body[unparsed]).digest('hex'),
    'utf-8'
  )
  if (
    remoteSig.length !== digest.length ||
    !crypto.timingSafeEqual(digest, remoteSig)
  ) {
    console.log(`remote ${remoteSig}, local ${digest}`)
    if (process.env.NODE_ENV === 'production') {
      return (ctx.status = 403)
    }
  }
  const dir =
    ctx.request.body.repository.name === 'mcwzh-meme-resourcepack'
      ? jePath
      : bePath
  let result = ''
  try {
    unlinkSync(resolve(dir, '.git/index.lock'))
  } catch (e) { }
  let r = await execPromise(`git reset --hard @{u}`, { cwd: dir })
  result += r.stdout
  r = await execPromise(`git clean -df`, { cwd: dir })
  result += '\n' + r.stdout
  r = await execPromise(`git pull`, { cwd: dir })
  result += '\n' + r.stdout

  result +=
    '\n' +
    JSON.stringify(
      (
        await axios({
          url: ctx.request.body.deployment.statuses_url,
          method: 'post',
          data: {
            state: 'success',
          },
          headers: {
            Authorization: `token ${process.env.GH_TOKEN}`,
          },
        })
      ).data
    )
  createLegacyMapping()

  ctx.body = {
    stdout: result,
    dir,
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

const server = app.listen(~~process.env.FC_SERVER_PORT || 8000)
server.timeout = 0
server.keepAliveTimeout = 0
