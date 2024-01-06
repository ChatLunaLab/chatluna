import { Context, Logger } from 'koishi'
import { RedisVectorStore } from 'langchain/vectorstores/redis'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { Config } from '..'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'

let logger: Logger

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    logger = createLogger(ctx, 'chatluna-vector-store-service')

    await plugin.registerVectorStore('redis', async (params) => {
        const embeddings = params.embeddings

        const client = await createClient(config.redisUrl)

        await client.connect()

        return await RedisVectorStore.fromTexts(
            ['sample'],
            [' '],
            embeddings,

            {
                redisClient: client,
                indexName: params.key ?? 'chatluna'
            }
        )
    })
}

async function createClient(url: string) {
    const redis = await importRedis()

    return redis.createClient({
        url
    })
}

async function importRedis() {
    try {
        const any = await import('redis')

        return any
    } catch (err) {
        logger.error(err)
        throw new Error(
            'Please install redis as a dependency with, e.g. `npm install -S redis`'
        )
    }
}
