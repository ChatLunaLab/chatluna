import { Context } from 'koishi'
import { logger } from 'koishi-plugin-chatluna'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'
import { MemoryRetrievalLayerType } from '../types'
import { Config } from '..'

export function apply(ctx: Context, config: Config) {
    const chain = ctx.chatluna.chatChain

    chain
        .middleware(
            'clear_memory',
            async (session, context) => {
                let {
                    command,
                    options: { type, room, view }
                } = context

                if (command !== 'clear_memory')
                    return ChainMiddlewareRunStatus.SKIPPED

                if (!type) {
                    type = room.preset
                }

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
                    const layers =
                        await ctx.chatluna_long_memory.initMemoryLayers(
                            {
                                presetId: type as string,
                                guildId: session.guildId || session.channelId,
                                userId: session.userId
                            },
                            room.conversationId,
                            parsedLayerType
                        )

                    await Promise.all(
                        layers.map((layer) => layer.clearMemories())
                    )

                    await ctx.chatluna.clearCache(room)
                    context.message = session.text('.clear_success')
                } catch (error) {
                    logger?.error(error)
                    context.message = session.text('.clear_failed')
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        clear_memory: never
    }
}
