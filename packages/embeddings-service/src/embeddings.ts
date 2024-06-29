import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '.'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
// import start
import { apply as huggingface } from './embeddings/huggingface' // import end

export async function embeddings(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin<ClientConfig, Config>
) {
    type Embeddings = (
        ctx: Context,
        config: Config,
        plugin: ChatLunaPlugin<ClientConfig, Config>
    ) => PromiseLike<void> | void

    const middlewares: Embeddings[] =
        // middleware start
        [huggingface] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, plugin)
    }
}
