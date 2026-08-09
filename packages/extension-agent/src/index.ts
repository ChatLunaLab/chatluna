/** @module extension-agent */

import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { ChatLunaAgentService } from './service'
import { migrateAgentData } from './config/migrate'
import { readConfig } from './config/read'
import * as webui from './webui'
import * as mcpCommands from './commands/mcp'
import * as agentCommands from './commands/agent'
import * as taskCommands from './commands/task'
import { cleanupExpiredOutputs } from './computer/backends/local/output'

export * from './types'

export let logger: Logger
export let plugin: ChatLunaPlugin<ClientConfig, Config>

export async function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-agent')

    plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'agent',
        false
    )
    await migrateAgentData(ctx)

    ctx.plugin(ChatLunaAgentService, {
        config: await readConfig(ctx),
        plugin
    })

    ctx.setInterval(
        () => {
            cleanupExpiredOutputs(60 * 60 * 1000).catch((err) => {
                logger.error(err)
            })
        },
        10 * 60 * 1000
    )

    ctx.plugin(webui)
    ctx.plugin(mcpCommands)
    ctx.plugin(agentCommands)
    ctx.plugin(taskCommands)
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        mcpToolMode: Schema.union([
            Schema.const('eager'),
            Schema.const('catalog')
        ]).default('eager')
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export interface Config extends ChatLunaPlugin.Config {
    mcpToolMode: 'eager' | 'catalog'
}

export const inject = {
    required: ['chatluna', 'console'],
    optional: ['chatluna_storage', 'chatluna_agent', 'server', 'database']
}

export const name = 'chatluna-agent'
