import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform

    chain
        .middleware('set_default_vectorstore', async (session, context) => {
            const { command, options } = context

            if (command !== 'set_vector_store')
                return ChainMiddlewareRunStatus.SKIPPED

            const { setVectorStore } = options

            if (!setVectorStore) {
                context.message =
                    '你可以使用 chatluna.vectorstore.set <model> 来设置默认使用的向量数据库'
            }

            // eslint-disable-next-line max-len
            const targetVectorStoreProviders = service
                .getVectorStoreRetrievers()
                .filter((vectorStoreProviderName) =>
                    vectorStoreProviderName.includes(setVectorStore)
                )

            if (targetVectorStoreProviders.length > 1) {
                const buffer: string[] = []

                buffer.push('基于你的输入，找到了以下向量数据库：\n')

                for (const vectorStoreProvider of targetVectorStoreProviders) {
                    buffer.push(vectorStoreProvider)
                }

                buffer.push('请输入更精确的向量数据库名称以避免歧义')

                buffer.push(
                    '例如：chatluna.vectorstore.set ' +
                        targetVectorStoreProviders[0]
                )

                context.message = buffer.join('\n')
            } else if (targetVectorStoreProviders.length === 0) {
                context.message = '找不到对应的向量数据库，请检查名称是否正确'
            }

            const targetProviderName = targetVectorStoreProviders[0]

            const keysCache = ctx.chatluna.cache

            await keysCache.set('default-vector-store', targetProviderName)

            await context.send(
                `已将默认向量数据库设置为 ${targetProviderName}，(将自动重启插件应用更改)`
            )

            config.defaultVectorStore = targetProviderName
            ctx.runtime.parent.scope.update(config, true)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_default_vectorstore: never
    }

    interface ChainMiddlewareContextOptions {
        setVectorStore?: string
    }
}
