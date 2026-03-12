import { Context, Logger, Schema } from 'koishi'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { ChatLunaAgentService } from './service'
import { readConfig } from './config/read'
import * as webui from './webui'
import * as commands from './commands/mcp'

export * from './types'

export let logger: Logger
export let plugin: ChatLunaPlugin

export async function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-agent')

    plugin = new ChatLunaPlugin(ctx, config, 'agent', false)

    const agentConfig = await readConfig(ctx)
    ctx.plugin(ChatLunaAgentService, {
        config: agentConfig,
        plugin
    })

    ctx.plugin(webui)
    ctx.plugin(commands)
}

export const Config: Schema<Config> = Schema.intersect([ChatLunaPlugin.Config])

export interface Config extends ChatLunaPlugin.Config {}

export const inject = {
    required: ['chatluna', 'console'],
    optional: ['chatluna_storage', 'chatluna_agent']
}

export const name = 'chatluna-agent'
