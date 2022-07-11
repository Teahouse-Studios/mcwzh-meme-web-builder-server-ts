import Koa from 'koa'
import Router from '@koa/router'
import axios from 'axios'
import { resolve } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import {
  BedrockPackBuilder,
  JavaPackBuilder,
  ModuleParser,
  Logger,
  CURRENT_FORMAT_VERSION,
} from 'memepack-builder'
import cors from '@koa/cors'
import koaBody from 'koa-body'
import unparsed from 'koa-body/unparsed.js'
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

const jeModules = new ModuleParser(resolve(jePath, 'modules'))
const beModules = new ModuleParser(resolve(bePath, 'modules'))

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

router.get(['/', '/v2/modules'], async (ctx) => {
  const jeModulesInfo = (await jeModules.moduleInfo()).modules.map(
    ({ languageModification, ...rest }) => ({ ...rest })
  )
  const beModulesInfo = (await beModules.moduleInfo()).modules.map(
    ({ languageModification, ...rest }) => ({ ...rest })
  )
  try {
    let mods = (await readdirSync(resolve(jePath, 'mods'))).map(
      (v) => `mods/${v}`
    )
    let enmods = (await readdirSync(resolve(jePath, 'en-mods'))).map(
      (v) => `en-mods/${v}`
    )
    const warning =
      ctx.path === '/'
        ? {
            warning:
              'Warning: v0 api is deprecated and will be REMOVED very soon. Please remove its usage and use /v2/modules instead.',
          }
        : {}
    ctx.body = {
      ...warning,
      mods,
      enmods,
      je_modules: {
        resource: jeModulesInfo.filter((i) => {
          return i.type === 'resource'
        }),
        collection: jeModulesInfo.filter((i) => {
          return i.type === 'collection'
        }),
      },
      be_modules: {
        resource: beModulesInfo.filter((i) => {
          return i.type === 'resource'
        }),
        collection: beModulesInfo.filter((i) => {
          return i.type === 'collection'
        }),
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

router.post('/v2/build/java', async (ctx) => {
  const {
    type = 'normal',
    modules = [],
    format = CURRENT_FORMAT_VERSION,
    mods = [],
  } = ctx.request.body

  const mod = mods.map((v) => resolve(jePath, v))

  const builder = new JavaPackBuilder(
    await jeModules.moduleInfo(),
    resolve(jePath, 'meme_resourcepack'),
    {
      modFiles: mod,
    }
  )
  try {
    Logger.appendLog(`Recieved request with options:
    Platform: Java
    Target type: ${type} ${
      {
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
    let r = await builder.build({
      type: type === 'legacy' ? 'legacy' : 'normal',
      modules,
      mod,
      format,
      hash: true,
      compatible: type === 'compatible',
      platform: 'java',
    })
    let exist = true
    const name =
      'meme.teahouse.team-' +
      r.hash.substring(0, 6) +
      (type === 'mcpack' ? '.mcpack' : '.zip')
    try {
      await client.statObject(process.env.S3_BUCKET, name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      Logger.appendLog('Uploading file to Bucket...')
      await client.putObject(process.env.S3_BUCKET, name, r.content)
    }
    const warnings = Logger.log.filter((v) => v.match(/warn/))
    Logger.appendLog(
      `Built ${name} ${
        warnings.length > 0
          ? `with ${warnings.length} warning(s)`
          : 'successfully'
      }.`
    )
    ctx.body = {
      logs: Logger.log.join('\n'),
      filename: name,
      root: process.env.S3_ROOT,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs: e.toString() + '\n' + Logger.log.join('\n'),
    }
  } finally {
    Logger.clearLog()
  }
})

router.post('/v2/build/bedrock', async (ctx) => {
  const { type = 'normal', modules = [], extension = 'zip' } = ctx.request.body
  const mod = [].map((v) => resolve(bePath, v))

  const builder = new BedrockPackBuilder(
    await beModules.moduleInfo(),
    resolve(bePath, 'meme_resourcepack'),
    {
      modFiles: mod,
    }
  )
  try {
    Logger.appendLog(`Recieved request with options:
    Platform: Bedrock
    Target type: ${type} ${
      {
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
    let exist = true
    const name =
      'meme.teahouse.team-' +
      r.hash.substring(0, 6) +
      (type === 'mcpack' ? '.mcpack' : '.zip')
    try {
      await client.statObject(process.env.S3_BUCKET, name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      Logger.appendLog('Uploading file to Bucket...')
      await client.putObject(process.env.S3_BUCKET, name, r.content)
    }
    Logger.appendLog(`Built ${name} successfully.`)
    ctx.body = {
      logs: Logger.log.join('\n'),
      filename: name,
      root: process.env.S3_ROOT,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs: e.toString() + '\n' + Logger.log.join('\n'),
    }
  } finally {
    Logger.clearLog()
  }
})

router.post('/ajax', async (ctx) => {
  const { type, modules, format, compatible } = ctx.request.body
  const _be = Boolean(ctx.request.body._be)

  const mod = ctx.request.body.mod.map((v) => resolve(_be ? bePath : jePath, v))

  const je = new JavaPackBuilder(
    await jeModules.moduleInfo(),
    resolve(jePath, 'meme_resourcepack'),
    {
      modFiles: mod,
    }
  )
  const be = new BedrockPackBuilder(
    await beModules.moduleInfo(),
    resolve(bePath, 'meme_resourcepack'),
    {
      modFiles: mod,
    }
  )
  try {
    let r = _be
      ? await be.build({
          type,
          modules,
          hash: true,
          compatible,
          platform: 'bedrock',
        })
      : await je.build({
          type,
          modules,
          mod,
          format,
          hash: true,
          compatible,
          platform: 'java',
        })
    let exist = true
    const name =
      'meme.teahouse.team-' +
      r.hash.substring(0, 6) +
      (type === 'mcpack' ? '.mcpack' : '.zip')
    try {
      await client.statObject(process.env.S3_BUCKET, name)
    } catch (e) {
      exist = false
    }
    if (!exist) {
      Logger.appendLog('Reupload...')
      await client.putObject(process.env.S3_BUCKET, name, r.content)
    }
    Logger.appendLog('Built success.')
    ctx.body = {
      logs:
        'Warning: v0 api is deprecated and will be REMOVED very soon. Please remove its usage and use /v2/build/:edition instead.\n' +
        Logger.log.join('\n'),
      filename: name,
      root: process.env.S3_ROOT,
    }
  } catch (e) {
    console.error(e)
    ctx.status = 403
    ctx.body = {
      logs:
        'Warning: v0 api is deprecated and will be REMOVED very soon. Please remove its usage and use /v2/build/:edition instead.\n' +
        e.toString() +
        '\n' +
        Logger.log.join('\n'),
    }
  } finally {
    Logger.clearLog()
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
  } catch (e) {}
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
