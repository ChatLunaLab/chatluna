/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaMCPClientService } from './service'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-mcp-client')

    ctx.on('ready', async () => {
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
    tools: Record<
        string,
        {
            name: string
            description: string
            enabled: boolean
            selector: string[]
        }
    >
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
        ),
        tools: Schema.dynamic('tools')
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna']

export const name = 'chatluna-mcp-client'
