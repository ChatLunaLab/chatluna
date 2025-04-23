/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaMCPClientService } from './service'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-mcp-client')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'mcp-client',
        false
    )

    ctx.on('ready', async () => {
        plugin.registerToService()
        ctx.plugin(ChatLunaMCPClientService, config)
    })
}

export interface Config extends ChatLunaPlugin.Config {
    server: {
        type: 'stdio' | 'sse' | 'stream-http'
        url?: string
        stdio?: {
            command: string
            args?: string[]
            env?: Record<string, string>
            cwd?: string
        }
    }[]
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        server: Schema.array(
            Schema.object({
                type: Schema.union(['stdio', 'sse', 'stream-http']).default(
                    'stdio'
                ),
                url: Schema.string().role('url'),
                stdio: Schema.object({
                    command: Schema.string(),
                    args: Schema.array(String),
                    env: Schema.dict(String).role('table'),
                    cwd: Schema.string()
                })
            })
        )
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-mcp-client'
