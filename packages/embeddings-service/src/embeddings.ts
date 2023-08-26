import { Context } from 'koishi'
import fs from 'fs/promises'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { Config } from '.'
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'

export async function embeddings(ctx: Context, config: Config, plugin: ChatHubPlugin<ClientConfig, Config>) {

    const list = await fs.readdir(`${__dirname}/embeddings`)

    for (const file of list) {
        if (file.endsWith(".d.ts")) {
            continue
        }

        const embeddings: {
            apply: (ctx: Context, config: Config, plugin: ChatHubPlugin<ClientConfig, Config>) => PromiseLike<void> | void
        } = await require(`./embeddings/${file}`)

        if (embeddings.apply) {
            await embeddings.apply(ctx, config, plugin)
        }
    }
}