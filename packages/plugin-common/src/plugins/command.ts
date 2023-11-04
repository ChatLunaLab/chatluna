/* eslint-disable max-len */
import { Context, Session } from 'koishi'
import { Config } from '..'
import { Tool } from 'langchain/tools'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'
import { fuzzyQuery } from '@dingyi222666/koishi-plugin-chathub/lib/utils/string'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatHubPlugin
) {
    if (config.command !== true) {
        return
    }
    plugin.registerTool('command_help', {
        selector(history) {
            return fuzzyQuery(history[history.length - 1].content, [
                '指令',
                '获取',
                'get',
                'help',
                'command'
            ])
        },
        alwaysRecreate: true,

        async createTool(params, session) {
            return new CommandListTool(session)
        }
    })

    plugin.registerTool('command_execute', {
        selector(history) {
            return fuzzyQuery(history[history.length - 1].content, [
                '指令',
                '获取',
                'get',
                'help',
                'command',
                '执行',
                'execute'
            ])
        },
        alwaysRecreate: true,

        async createTool(params, session) {
            return new CommandExecuteTool(session)
        }
    })
}

export class CommandExecuteTool extends Tool {
    name = 'command_execute'

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        const validationString = randomString(8)
        const session = this.session

        await session.send(
            `模型请求执行指令 ${input} ，如需同意，请输入以下字符：${validationString}`
        )
        const canRun = await this.session.prompt()

        if (canRun !== validationString) {
            await this.session.send('指令执行失败')
            return `The command ${input} execution failed, because the user didn't confirm`
        }

        let content = input
        for (const prefix of resolvePrefixes(session)) {
            if (!content.startsWith(prefix)) continue
            content = content.slice(prefix.length)
            break
        }

        try {
            await this.session.execute(content)
            return `Successfully executed command ${content}`
        } catch (e) {
            return `The command ${input} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line max-len
    description = `Execute a command. The input is characters such as:
    plugin.uninstall mc
    `
}

export class CommandListTool extends Tool {
    name = 'command_help'

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        let content = input
        for (const prefix of resolvePrefixes(this.session)) {
            if (content == null) break
            if (!content.startsWith(prefix)) continue
            content = content.slice(prefix.length)
            break
        }

        const result = await this.session.execute(
            'help ' + (content?.replace('help', '') ?? ''),
            true
        )

        if (result.length < 1) return 'Command not found, check your prefix'

        return result
    }

    // eslint-disable-next-line max-len
    description = `IIt is a command help tool, which can also be used to find supported commands. Similar to most help commands, you can invoke it layer by layer by typing a command, such as "xx", and if it is "help", it will return a top level command list, such as

    help help
    status Current machine status information

    Otherwise, it will return a list of subcommands, such as "plugin".
    plugin.install Installs the plugin

    You can invoke the command multiple times, or you can invoke sub-level commands for help, such as command arguments.

    We recommend that you call the tool multiple times to determine which command you ultimately need.`
}

export function randomString(size: number) {
    let text = ''
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < size; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    return text
}

function resolvePrefixes(session: Session) {
    const value = session.resolve(session.app.config.prefix)

    return Array.isArray(value) ? value : [value || '']
}
