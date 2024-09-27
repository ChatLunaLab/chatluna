import { Context, Logger, User } from 'koishi'
import { ChatLunaService } from 'koishi-plugin-chatluna/services/chat'
import { forkScopeToDisposable } from 'koishi-plugin-chatluna/utils/koishi'
import {
    clearLogger,
    createLogger,
    setLoggerLevel
} from 'koishi-plugin-chatluna/utils/logger'
import * as request from 'koishi-plugin-chatluna/utils/request'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
import { ChatLunaAuthService } from './authorization/service'
import { command } from './command'
import { Config } from './config'
import { defaultFactory } from './llm-core/chat/default'
import { middleware } from './middleware'
import { deleteConversationRoom } from 'koishi-plugin-chatluna/chains'

export * from './config'
export const name = 'chatluna'
export const inject = {
    required: ['cache', 'database'],
    optional: ['censor', 'vits', 'puppeteer']
}
export const inject2 = {
    cache: {
        required: true
    },
    database: {
        required: true
    },
    censor: {
        required: false
    },
    vits: {
        required: false
    },
    puppeteer: {
        required: false
    }
}

export let logger: Logger

export const usage = `
## chatluna v1.0 beta

### 目前插件还在 beta 阶段，可能会有很多 bug，可以去插件主页那边提 issue 或加群反馈。

ChatLuna 插件交流群：282381753 （有问题不知道怎么弄先加群问）

群里目前没有搭载该插件的 bot，加群的话最好是来询问问题或者提出意见的

[文档](https://chatluna.chat) 也在缓慢制作中，有问题可以在群里提出。
`

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx)

    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ctx.i18n.define('zh-CN', require('./locales/zh-CN'))
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ctx.i18n.define('en-US', require('./locales/en-US'))

    const disposables: PromiseLikeDisposable[] = []

    ctx.on('ready', async () => {
        // set proxy before init service

        if (config.isProxy) {
            request.setGlobalProxyAddress(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                config.proxyAddress ?? (ctx.http.config as any).proxyAgent
            )

            logger.debug(
                'global proxy %c',
                config.proxyAddress,
                request.globalProxyAddress
            )
        }

        disposables.push(
            forkScopeToDisposable(ctx.plugin(ChatLunaService, config))
        )
        disposables.push(
            forkScopeToDisposable(ctx.plugin(ChatLunaAuthService, config))
        )

        {
            const disposable = ctx.permissions.define('chatluna:admin', {
                inherits: ['authority.3']
            })

            disposables.push(() => {
                disposable()
            })
        }

        {
            const disposable = ctx.permissions.provide(
                'chatluna:admin',
                async (name, session) => {
                    return (
                        (
                            await session.getUser<User.Field>(session.userId, [
                                'authority'
                            ])
                        )?.authority >= 3
                    )
                }
            )

            disposables.push(() => {
                disposable()
            })
        }

        const disposable = forkScopeToDisposable(
            ctx.plugin(
                {
                    apply: (ctx: Context, config: Config) => {
                        ctx.on('ready', async () => {
                            await defaultFactory(ctx, ctx.chatluna.platform)
                            await middleware(ctx, config)
                            await command(ctx, config)
                            await ctx.chatluna.preset.init()

                            await setupAutoDelete(ctx)
                        })

                        ctx.middleware(async (session, next) => {
                            if (
                                ctx.chatluna == null ||
                                ctx.chatluna.chatChain == null
                            ) {
                                return next()
                            }

                            return next(async (_) => {
                                await ctx.chatluna.chatChain.receiveMessage(
                                    session,
                                    ctx
                                )
                            })
                        })
                    },
                    inject: {
                        ...inject2,
                        chatluna: {
                            required: true
                        },
                        chatluna_auth: {
                            required: false
                        },
                        database: {
                            required: false
                        }
                    },
                    name: 'chatluna_entry_point'
                },
                config
            )
        )

        disposables.push(disposable)
    })

    async function setupAutoDelete(ctx: Context) {
        if (!config.autoDelete) {
            return
        }

        async function execute() {
            const rooms = await ctx.database.get('chathub_room', {
                updatedTime: {
                    $lt: new Date(Date.now() - config.autoDeleteTimeout)
                }
            })

            if (rooms.length === 0) {
                return
            }

            for (const room of rooms) {
                try {
                    await deleteConversationRoom(ctx, room)
                } catch (e) {
                    logger.error(e)
                }
            }

            logger.success(
                `auto delete %c rooms [%c]`,
                rooms.length,
                rooms.map((room) => room.roomName).join(',')
            )

            // 30 分钟一次
            return ctx.setTimeout(execute, 30 * 60 * 1000)
        }

        await execute()
    }

    ctx.on('dispose', async () => {
        clearLogger()

        for (const disposable of disposables) {
            disposable()
        }
    })
}
