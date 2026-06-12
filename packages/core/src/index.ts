/* eslint-disable @typescript-eslint/no-var-requires */
import { Context, Logger, Time, User } from 'koishi'
import { ChatLunaService } from 'koishi-plugin-chatluna/services/chat'
import { forkScopeToDisposable } from 'koishi-plugin-chatluna/utils/koishi'
import {
    clearLogger,
    createLogger,
    setLoggerLevel
} from 'koishi-plugin-chatluna/utils/logger'
import * as request from 'koishi-plugin-chatluna/utils/request'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
import { command } from './command'
import { Config } from './config'
import { applyAgentTaskWakeup } from './llm-core/agent/wakeup'
import { defaultFactory } from './llm-core/chat/default'
import { apply as loreBook } from './llm-core/memory/lore_book'
import { apply as authorsNote } from './llm-core/memory/authors_note'
import { ensureMigrationValidated } from './migration/room_to_conversation'
import { middleware } from './middleware'
import type { ConstraintRecord } from './types'
import { purgeArchivedConversation } from './utils/archive'

export * from './config'
export * from './render'
export * from './types'
export * from '@vue/reactivity'
export const name = 'chatluna'
export const inject = {
    required: ['database'],
    optional: ['censor', 'vits', 'sst', 'chatluna_storage']
}
export const inject2 = {
    database: { required: true },
    censor: { required: false },
    vits: { required: false },
    chatluna_storage: { required: false }
}

export let logger: Logger

export const usage = `
## chatluna v1.3

ChatLuna 插件交流 QQ 群：282381753 （有问题或出现 Bug 先加群问）

群里目前没有搭载该插件的 bot，加群的话最好是来询问问题或者提出意见的。

访问 [https://chatluna.chat](https://chatluna.chat) 来了解如何使用 Chatluna。
也可以访问 [https://preset.chatluna.chat](https://preset.chatluna.chat) 进入在线预设编辑器。更有预设广场来浏览和下载你心仪的预设。
`

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx)
    setupLogger(config)
    setupI18n(ctx)

    const disposables: PromiseLikeDisposable[] = []

    ctx.on('ready', async () => {
        setupProxy(ctx, config)
        await dedupeConstraintNames(ctx)
        setupServices(ctx, config, disposables)
        setupPermissions(ctx, disposables)
        setupEntryPoint(ctx, config, disposables)
    })

    ctx.on('dispose', async () => {
        clearLogger()
        disposables.forEach((disposable) => disposable())
    })
}

function setupEntryPoint(
    ctx: Context,
    config: Config,
    disposables: PromiseLikeDisposable[]
) {
    const entryPointPlugin = (ctx: Context, config: Config) => {
        ctx.on('ready', async () => {
            await initializeComponents(ctx, config)
            setupMiddleware(ctx)
        })
    }

    const entryPointDisposable = forkScopeToDisposable(
        ctx.plugin(
            {
                apply: entryPointPlugin,
                inject: {
                    ...inject2,
                    chatluna: { required: true },
                    chatluna_storage: { required: false },
                    database: { required: false },
                    notifier: { required: false }
                },
                name: 'chatluna_entry_point'
            },
            config
        )
    )
    disposables.push(entryPointDisposable)
}

async function initializeComponents(ctx: Context, config: Config) {
    await ensureMigrationValidated(ctx, config)
    await defaultFactory(ctx, ctx.chatluna.platform)
    await middleware(ctx, config)
    await command(ctx, config)
    await ctx.chatluna.preset.init()
    await setupAutoArchive(ctx, config)
    await setupAutoPurgeArchive(ctx, config)
    applyAgentTaskWakeup(ctx, config)
    loreBook(ctx, config)
    authorsNote(ctx, config)
}

function setupMiddleware(ctx: Context) {
    ctx.middleware((session, next) => {
        if (ctx.chatluna == null || ctx.chatluna.chatChain == null) {
            return next()
        }
        return next(async (nextMiddleware) => {
            const messageHandled = await ctx.chatluna.chatChain.receiveMessage(
                session,
                ctx
            )

            if (!messageHandled) {
                return await nextMiddleware()
            }
        })
    })
}

function setupLogger(config: Config) {
    if (config.isLog) {
        setLoggerLevel(Logger.DEBUG)
    }
}

function setupI18n(ctx: Context) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ctx.i18n.define('zh-CN', require('./locales/zh-CN'))
    ctx.i18n.define('en-US', require('./locales/en-US'))
}

function setupProxy(ctx: Context, config: Config) {
    if (config.isProxy) {
        request.setGlobalProxyAddress(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config.proxyAddress ||
                (ctx.http['config'] ?? ctx.http['currentConfig'])?.proxyAgent
        )
        logger.debug('global proxy %c', config.proxyAddress)
    }
}

function setupServices(
    ctx: Context,
    config: Config,
    disposables: PromiseLikeDisposable[]
) {
    disposables.push(forkScopeToDisposable(ctx.plugin(ChatLunaService, config)))
}

function setupPermissions(ctx: Context, disposables: PromiseLikeDisposable[]) {
    const adminPermissionDisposable = ctx.permissions.define('chatluna:admin', {
        inherits: ['authority.3']
    })
    disposables.push(() => {
        adminPermissionDisposable()
    })

    const adminProviderDisposable = ctx.permissions.provide(
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
        adminProviderDisposable()
    })
}

async function setupAutoArchive(ctx: Context, config: Config) {
    if (!config.autoArchive) {
        return
    }

    async function execute() {
        if (!ctx.scope.isActive) {
            return
        }

        try {
            const cutoff = new Date(
                Date.now() - config.autoArchiveTimeout * 1000
            )
            const conversations = await ctx.database.get(
                'chatluna_conversation',
                {
                    updatedAt: {
                        $lt: cutoff
                    },
                    status: 'active'
                }
            )

            if (conversations.length === 0) {
                return
            }

            logger.info('Auto archive task running')

            let success = 0

            for (const conversation of conversations) {
                try {
                    const archived =
                        await ctx.chatluna.conversation.archiveConversationById(
                            conversation.id,
                            cutoff
                        )

                    if (archived != null) {
                        success += 1
                    }
                } catch (e) {
                    logger.error(e)
                }
            }

            logger.success(`Successfully archived %d conversations`, success)
        } catch (e) {
            logger.error(e)
        }
    }

    await execute()

    ctx.setInterval(async () => {
        await execute()
    }, Time.minute * 5)
}

async function setupAutoPurgeArchive(ctx: Context, config: Config) {
    if (!config.autoPurgeArchive) {
        return
    }

    async function execute() {
        if (!ctx.scope.isActive) {
            return
        }

        try {
            const cutoff = new Date(
                Date.now() - config.autoPurgeArchiveTimeout * 1000
            )
            const conversations = await ctx.database.get(
                'chatluna_conversation',
                {
                    archivedAt: {
                        $lt: cutoff
                    },
                    status: 'archived'
                }
            )

            if (conversations.length === 0) {
                return
            }

            logger.info('Auto purge archive task running')

            let success = 0

            for (const conversation of conversations) {
                try {
                    const purged =
                        await ctx.chatluna.conversationRuntime.withConversationSync(
                            conversation,
                            async () => {
                                const current =
                                    await ctx.chatluna.conversation.getConversation(
                                        conversation.id
                                    )

                                if (
                                    current == null ||
                                    current.status !== 'archived' ||
                                    current.archivedAt == null ||
                                    current.archivedAt.getTime() >=
                                        cutoff.getTime()
                                ) {
                                    return false
                                }

                                await purgeArchivedConversation(ctx, current)
                                return true
                            }
                        )

                    if (purged) {
                        success += 1
                    }
                } catch (e) {
                    logger.error(e)
                }
            }

            logger.success(
                `Successfully purged %d archived conversations`,
                success
            )
        } catch (e) {
            logger.error(e)
        }
    }

    await execute()

    ctx.setInterval(async () => {
        await execute()
    }, Time.minute * 10)
}

async function dedupeConstraintNames(ctx: Context) {
    try {
        const rows = (await ctx.database.get(
            'chatluna_constraint',
            {}
        )) as ConstraintRecord[]

        if (rows.length < 2) {
            return
        }

        const names = new Set<string>()
        const ids = [...rows]
            .sort((left, right) => {
                const leftTime = left.updatedAt?.getTime() ?? 0
                const rightTime = right.updatedAt?.getTime() ?? 0

                if (leftTime !== rightTime) {
                    return rightTime - leftTime
                }

                return (right.id ?? 0) - (left.id ?? 0)
            })
            .filter((row) => {
                if (!names.has(row.name)) {
                    names.add(row.name)
                    return false
                }

                return row.id != null
            })
            .map((row) => row.id!)

        if (ids.length === 0) {
            return
        }

        logger.warn(
            `Removing ${ids.length} duplicate chatluna_constraint rows.`
        )
        await ctx.database.remove('chatluna_constraint', {
            id: ids
        })
    } catch {}
}
