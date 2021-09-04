import Koa from 'koa'
import Router from '@koa/router'
import { resolve } from 'path'
import { MemepackBuilder } from 'memepack-builder'

const app = new Koa()
const router = new Router()

const jePath = resolve(__dirname, 'data', 'mcwzh-meme-resource')

const je = new MemepackBuilder('je', resolve(jePath, 'meme_resourcepack'), resolve(jePath, 'modules'))

app.use(router.routes())
app.use(router.allowedMethods())

app.listen(9000)