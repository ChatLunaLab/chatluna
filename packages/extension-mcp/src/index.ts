/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema } from 'koishi'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaMCPClientService } from './service'
import * as command from './command'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export let logger: Logger
export let plugin: ChatLunaPlugin

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-mcp-client')

    plugin = new ChatLunaPlugin(ctx, config, 'mcp-client', false)

    ctx.plugin(ChatLunaMCPClientService, config)

    ctx.plugin(command, config)
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        servers: Schema.string().role('textarea').default('{"mcpServers": {}}'),
        tools: Schema.dict(
            Schema.object({
                name: Schema.string().required(),
                enabled: Schema.boolean().default(true),
                timeout: Schema.number().default(60),
                selector: Schema.array(Schema.string()).default([])
            })
        )
            .role('table')
            .default({})
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
})

export interface Config extends ChatLunaPlugin.Config {
    server?: Record<
        string,
        {
            url?: string
            command?: string
            args?: string[]
            headers?: Record<string, string>
            type: 'http' | 'studio' | 'streamable_http'
            env?: Record<string, string>
            timeout?: number
            cwd?: string
            proxy?: string
        }
    >
    servers: string
    tools?: Record<
        string,
        {
            name: string
            timeout?: number
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
