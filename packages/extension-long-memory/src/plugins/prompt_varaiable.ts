import { Context } from 'koishi'
import { Config, logger, MemoryRetrievalLayerType } from '..'
import { enhancedMemoryToDocument, isMemoryExpired } from '../utils/memory'
import { FunctionProvider } from '@chatluna/shared-prompt-renderer'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

export async function apply(ctx: Context, config: Config) {
    const handler: FunctionProvider = async (args, variables, configurable) => {
        const session = configurable.session

        const layerTypes = (args.length > 0 ? args : config.enabledLayers)
            .map(
                (layer) =>
                    MemoryRetrievalLayerType[
                        layer.toUpperCase() as keyof typeof MemoryRetrievalLayerType
                    ]
            )
            .filter((v): v is MemoryRetrievalLayerType => v != null)

        logger.debug(`Mapper layers: ${layerTypes}`)

        const layers = await ctx.chatluna_long_memory.initMemoryLayers(
            {
                presetId: variables['built']?.['preset'] || 'default',
                userId: session.userId,
                guildId: session.guildId || session.channelId
            },
            variables['built']?.['conversationId'],
            layerTypes
        )

        const searchContent = Array.isArray(variables['prompt'])
            ? getMessageContent(variables['prompt'])
            : typeof variables['prompt'] === 'string'
              ? variables['prompt']
              : ''

        const memories = await Promise.all(
            layers.map((layer) => layer.retrieveMemory(searchContent))
        )

        const validMemories = memories
            .flat()
            .filter((memory) => !isMemoryExpired(memory))

        const documents = validMemories.map(enhancedMemoryToDocument)

        if (documents.length === 0) {
            return ''
        }

        const memoriesByLayer = new Map<
            MemoryRetrievalLayerType,
            {
                doc: (typeof documents)[0]
                memory: (typeof validMemories)[0]
            }[]
        >()

        validMemories.forEach((memory, index) => {
            const layerName =
                memory.retrievalLayer || MemoryRetrievalLayerType.USER
            if (!memoriesByLayer.has(layerName)) {
                memoriesByLayer.set(layerName, [])
            }
            memoriesByLayer
                .get(layerName)!
                .push({ doc: documents[index], memory })
        })

        const sections: string[] = []

        const layerOrder = [
            {
                key: MemoryRetrievalLayerType.GLOBAL,
                name: 'Global Memories'
            },
            { key: MemoryRetrievalLayerType.GUILD, name: 'Guild Memories' },
            {
                key: MemoryRetrievalLayerType.PRESET,
                name: 'Preset Memories'
            },
            { key: MemoryRetrievalLayerType.USER, name: 'User Memories' }
        ]

        for (const { key, name } of layerOrder) {
            const layerMemories = memoriesByLayer.get(key)
            if (!layerMemories || layerMemories.length === 0) continue

            layerMemories.sort(
                (a, b) =>
                    (b.memory.importance || 5) - (a.memory.importance || 5)
            )

            const memoryItems = layerMemories.map(({ doc, memory }) => {
                const parts: string[] = []

                parts.push(`  Content: ${doc.pageContent}`)

                if (memory.type) {
                    parts.push(`  Type: ${memory.type}`)
                }

                if (memory.importance) {
                    parts.push(`  Importance: ${memory.importance}/10`)
                }

                if (memory.expirationDate) {
                    const daysUntilExpiration = Math.ceil(
                        (memory.expirationDate.getTime() - Date.now()) /
                            (1000 * 60 * 60 * 24)
                    )
                    if (daysUntilExpiration > 0) {
                        parts.push(
                            `  Expires in: ${daysUntilExpiration} day(s)`
                        )
                    }
                }

                parts.push(`  ID: ${doc.id}`)

                return parts.join('\n')
            })

            sections.push(`## ${name}\n\n${memoryItems.join('\n\n')}`)
        }

        // eslint-disable-next-line max-len
        const header = `# Long-term Memory Context\n\nThe following memories have been retrieved based on the current conversation context. These memories represent important information from previous interactions across different scopes.\n`

        const result = header + '\n' + sections.join('\n\n')

        return result
    }

    ctx.effect(() =>
        ctx.chatluna.promptRenderer.registerFunctionProvider(
            'long_memory',
            async (args, variables, configurable) => {
                try {
                    return await handler(args, variables, configurable)
                } catch (error) {
                    logger.error(error)
                    return 'Error retrieving long-term memory'
                }
            }
        )
    )
}
