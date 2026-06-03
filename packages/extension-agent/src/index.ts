/** @module extension-agent */

import { Context, Logger, Schema } from 'koishi'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { ChatLunaAgentService } from './service'
import { migrateAgentData } from './config/migrate'
import { readConfig } from './config/read'
import * as webui from './webui'
import * as mcpCommands from './commands/mcp'
import * as agentCommands from './commands/agent'

export * from './types'

export let logger: Logger
export let plugin: ChatLunaPlugin

export async function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-agent')

    plugin = new ChatLunaPlugin(ctx, config, 'agent', false)
    await migrateAgentData(ctx)

    ctx.plugin(ChatLunaAgentService, {
        config: await readConfig(ctx),
        plugin
    })

    ctx.plugin(webui)
    ctx.plugin(mcpCommands)
    ctx.plugin(agentCommands)
}

export const Config: Schema<Config> = Schema.intersect([ChatLunaPlugin.Config])

export interface Config extends ChatLunaPlugin.Config {}

export const inject = {
    required: ['chatluna', 'console'],
    optional: ['chatluna_storage', 'chatluna_agent', 'server', 'database']
}

export const name = 'chatluna-agent'
