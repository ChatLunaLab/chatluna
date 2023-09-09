import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chathub.embeddings', 'chathub 嵌入模型相关指令', {
        authority: 1
    })

    ctx.command('chathub.vectorstore', 'chathub 向量数据库相关指令', {
        authority: 1
    })

    ctx.command('chathub.embeddings.list', '列出所有目前支持的嵌入模型')
        .option('page', '-p <page:number> 页码')
        .option('limit', '-l <limit:number> 每页数量')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_embeddings', {
                page: options.page ?? 1,
                limit: options.limit ?? 5
            })
        })

    ctx.command('chathub.vectorstore.list', '列出所有目前支持的向量数据库')
        .option('page', '-p <page:number> 页码')
        .option('limit', '-l <limit:number> 每页数量')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_vector_store', {
                page: options.page ?? 1,
                limit: options.limit ?? 5
            })
        })

    ctx.command('chathub.embeddings.set <embeddings:string>', '设置默认使用的嵌入模型', {
        authority: 3
    }).action(async ({ session }, embeddings) => {
        await chain.receiveCommand(session, 'set_embeddings', {
            setEmbeddings: embeddings
        })
    })

    ctx.command('chathub.vectorstore.set <vectorStore:string>', '设置默认使用的向量数据库', {
        authority: 3
    }).action(async ({ session }, vectorStore) => {
        await chain.receiveCommand(session, 'set_vector_store', {
            setVectorStore: vectorStore
        })
    })
}
