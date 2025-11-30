import { Context, Session } from 'koishi'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'
import { ChainMiddlewareRunStatus } from 'koishi-plugin-chatluna/chains'
import { logger } from 'koishi-plugin-chatluna'
import { EnhancedMemory, MemoryRetrievalLayerType } from '../types'
import { Config } from '..'

export function apply(ctx: Context, config: Config) {
    const chain = ctx.chatluna.chatChain

    const pagination = new Pagination<EnhancedMemory>({
        formatItem: (value) => '',
        formatString: {
            top: '',
            bottom: '',
            pages: ''
        }
    })

    chain
        .middleware(
            'search_memory',
            async (session, context) => {
                let {
                    command,
                    options: { page, limit, query, type, room, view }
                } = context

                if (command !== 'search_memory') {
                    return ChainMiddlewareRunStatus.SKIPPED
                }

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

                pagination.updateFormatString({
                    top:
                        session.text('.header', [
                            query,

                            parsedLayerType.toString().toLowerCase()
                        ]) + '\n',
                    bottom: session.text('.footer'),
                    pages: session.text('.pages')
                })

                pagination.updateFormatItem((value) =>
                    formatDocumentInfo(session, value)
                )

                query = query ?? ' '

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

                    const documents = await Promise.all(
                        layers.map((layer) => layer.retrieveMemory(query))
                    ).then((documents) => documents.flat())

                    await pagination.push(documents)

                    context.message = await pagination.getFormattedPage(
                        page,
                        limit
                    )
                } catch (error) {
                    logger?.error(error)
                    context.message = session.text('.search_failed')
                }

                return ChainMiddlewareRunStatus.STOP
            },
            ctx
        )
        .after('lifecycle-handle_command')
}

declare module 'koishi-plugin-chatluna/chains' {
    interface ChainMiddlewareName {
        search_memory: never
    }

    interface ChainMiddlewareContextOptions {
        query?: string
    }
}

async function formatDocumentInfo(session: Session, document: EnhancedMemory) {
    const buffer = []

    buffer.push(session.text('.document_id', [document.id]))
    buffer.push(session.text('.document_content', [document.content]))
    buffer.push(session.text('.document_type', [document.type]))
    buffer.push(session.text('.document_level', [document.importance]))
    buffer.push(
        session.text('.document_expire', [
            document.expirationDate?.toDateString()
        ])
    )

    buffer.push('\n')

    return buffer.join('\n')
}
