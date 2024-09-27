import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna.embeddings', { authority: 1 })

    ctx.command('chatluna.vectorstore', { authority: 1 })

    ctx.command('chatluna.embeddings.list')
        .option('page', '-p <page:number>')
        .option('limit', '-l <limit:number>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_embeddings', {
                page: options.page ?? 1,
                limit: options.limit ?? 5
            })
        })

    ctx.command('chatluna.vectorstore.list')
        .option('page', '-p <page:number>')
        .option('limit', '-l <limit:number>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_vector_store', {
                page: options.page ?? 1,
                limit: options.limit ?? 5
            })
        })

    ctx.command('chatluna.embeddings.set <embeddings:string>', {
        authority: 3
    }).action(async ({ session }, embeddings) => {
        await chain.receiveCommand(session, 'set_embeddings', {
            setEmbeddings: embeddings
        })
    })

    ctx.command('chatluna.vectorstore.set <vectorStore:string>', {
        authority: 3
    }).action(async ({ session }, vectorStore) => {
        await chain.receiveCommand(session, 'set_vector_store', {
            setVectorStore: vectorStore
        })
    })
}
