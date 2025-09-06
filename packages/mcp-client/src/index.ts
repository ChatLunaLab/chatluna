/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaMCPClientService } from './service'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-mcp-client')

    ctx.plugin(ChatLunaMCPClientService, config)
}

export const Config: Schema<Config> = Schema.object({
    servers: Schema.string()
        .role('textarea')
        .default('{\n\n\"mcpServers\": {\n\n\n\n}\n}')
    /*   tools: Schema.dynamic('tools') */
}).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
})

export interface Config {
    server?: Record<
        string,
        {
            url?: string
            command?: string
            args?: string[]
            type: 'http' | 'studio' | 'streamable_http'
            env?: Record<string, string>
            cwd?: string
        }
    >
    servers: string
    tools?: Record<
        string,
        {
            name: string
            description: string
            enabled: boolean
            selector: string[]
        }
    >
}

export const inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
}

export const name = 'chatluna-mcp-client'
