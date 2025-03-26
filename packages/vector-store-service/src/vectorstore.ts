import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
import { apply as faiss } from './vectorstore/faiss'
import { apply as lunavdb } from './vectorstore/lunavdb'
import { apply as milvus } from './vectorstore/milvus'
import { apply as redis } from './vectorstore/redis'
import { apply as neo4j } from './vectorstore/neo4j'

export async function vectorStore(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    type VectorStore = (
        ctx: Context,
        config: Config,
        plugin: ChatLunaPlugin
    ) => PromiseLike<void> | void

    const middlewares: VectorStore[] = [faiss, lunavdb, milvus, redis, neo4j]

    for (const middleware of middlewares) {
        try {
            await middleware(ctx, config, plugin)
        } catch (error) {
            ctx.logger.error(error)
        }
    }
}
