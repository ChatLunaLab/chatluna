import { Context } from 'koishi'
import { ChatChain } from '../../chains/chain'
import { Config } from '../../config'
export declare function apply(
    ctx: Context,
    config: Config,
    chain: ChatChain
): void
export interface EmbeddingsInfo {
    providerName: string
    model: string
}
declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        set_default_embeddings: never
    }
    interface ChainMiddlewareContextOptions {
        setEmbeddings?: string
    }
}
