import { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'
import { MemoryRetrievalLayerType, MemoryType } from '../types'
import { Config } from '..'
import { createDefaultMemory } from '../utils/memory'
import { getMemoryScope } from '../utils/conversation'
export function apply(ctx: Context, config: Config) {
    const chain = ctx.chatluna.chatChain

    chain
        .middleware(
            'edit_memory',
            async (session, context) => {
                const {
                    command,
                    options: {
                        type,
                        memoryId,
                        view,
                        conversationId,
                        presetLane
                    }
                } = context

                if (command !== 'edit_memory')
                    return ChainMiddlewareRunStatus.SKIPPED

                let parsedLayerType = MemoryRetrievalLayerType.USER

                if (view != null) {
                    parsedLayerType =
                        MemoryRetrievalLayerType[view.toUpperCase()]

                    if (parsedLayerType == null) {
                        context.message = session.text('.invalid_view', [
                            ['global', 'preset', 'user', 'preset_user'].join(
                                ', '
                            )
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }
                }
                try {
                    await session.send(session.text('.edit_memory_start'))

                    const content = await session.prompt()

                    const scope = await getMemoryScope(ctx, session, {
                        conversationId,
                        presetLane,
                        type
                    })

                    if (scope == null) {
                        context.message = session.text('.edit_failed')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    const layers =
                        await ctx.chatluna_long_memory.initMemoryLayers(
                            {
                                ...scope.info,
                                userId: session.userId,
                                guildId: session.guildId || session.channelId,
                                type: parsedLayerType,
                                memoryId
                            },
                            scope.conversation.id,
                            parsedLayerType
                        )

                    await Promise.all(
                        layers.map((layer) => layer.deleteMemories([memoryId]))
                    )

                    const memory = createDefaultMemory(
                        content,
                        MemoryType.PREFERENCE,
                        10
                    )

                    await Promise.all(
                        layers.map((layer) => layer.addMemories([memory]))
                    )

                    await ctx.chatluna.clearCache(scope.conversation)
                    context.message = session.text('.edit_success')
                } catch (error) {
                    logger?.error(error)
                    context.message = session.text('.edit_failed')
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        edit_memory: never
    }

    interface ChainMiddlewareContextOptions {
        memoryId?: string
        view?: string
    }
}
