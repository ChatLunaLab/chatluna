import { Context, ForkScope, Logger } from 'koishi'
import { clearLogger, createLogger, setLoggerLevel } from './utils/logger'
import * as request from './utils/request'
import { Config } from './config'
import { ChatLunaService } from './services/chat'
import { middleware } from './middleware'
import { command } from './command'
import { defaultFactory } from './llm-core/chat/default'
import { ChatLunaAuthService } from './authorization/service'

export * from './config'
export const name = 'chatluna'
export const inject = {
    required: ['cache', 'database'],
    optional: ['censor', 'vits', 'puppeteer']
}

export const usage = `
## chatluna v1.0 alpha

### 目前插件还在 alpha 阶段，可能会有很多 bug，可以去插件主页那边提 issue 或加群反馈。

ChatLuna 插件交流群：282381753 （有问题不知道怎么弄先加群问）

群里目前可能有搭载了该插件的 bot，加群的话最好是来询问问题或者提出意见的

[文档](https://chatluna.dingyi222666.top/) 也在缓慢制作中，有问题可以在群里提出

`

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx)
    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    const disposables: ForkScope[] = []

    ctx.on('ready', async () => {
        // set proxy before init service

        if (config.isProxy) {
            request.setGlobalProxyAddress(
                config.proxyAddress ?? ctx.http.config.proxyAgent
            )

            logger.debug('proxy %c', config.proxyAddress)
        }

        disposables.push(ctx.plugin(ChatLunaService, config))
        disposables.push(ctx.plugin(ChatLunaAuthService, config))

        disposables.push(
            ctx.plugin(
                {
                    apply: (ctx: Context, config: Config) => {
                        ctx.on('ready', async () => {
                            await defaultFactory(ctx, ctx.chatluna.platform)
                            await middleware(ctx, config)
                            await command(ctx, config)
                            await ctx.chatluna.preset.loadAllPreset()
                        })

                        ctx.middleware(async (session, next) => {
                            if (
                                ctx.chatluna == null ||
                                ctx.chatluna.chatChain == null
                            ) {
                                return next()
                            }

                            await ctx.chatluna.chatChain.receiveMessage(
                                session,
                                ctx
                            )

                            return next()
                        })
                    },
                    inject: {
                        required: inject.required.concat(
                            'chatluna',
                            'chatluna_auth'
                        ),
                        optional: inject.optional
                    },
                    name: 'chatluna_entry_point'
                },
                config
            )
        )
    })

    ctx.on('dispose', async () => {
        clearLogger()

        for (const disposable of disposables) {
            disposable.dispose()
        }
    })
}
