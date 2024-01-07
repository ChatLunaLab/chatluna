/* eslint-disable max-len */
import { Context, Session } from 'koishi'
import { Config } from '..'
import { Tool } from '@langchain/core/tools'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/lib/services/chat'
import { fuzzyQuery } from 'koishi-plugin-chatluna/lib/utils/string'
import { randomString } from './command'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.cron !== true) {
        return
    }

    await plugin.registerTool('cron', {
        selector(history) {
            return fuzzyQuery(history[history.length - 1].content as string, [
                '定时',
                '任务',
                '提醒',
                '调用',
                'do',
                '提示',
                '秒',
                '分',
                '时',
                '天',
                '星期',
                'cron',
                'task',
                'command'
            ])
        },
        alwaysRecreate: true,

        async createTool(params, session) {
            return new CronTool(session)
        }
    })
}

export class CronTool extends Tool {
    name = 'cron'

    constructor(public session: Session) {
        super({})
    }

    /** @ignore */
    async _call(input: string) {
        const validationString = randomString(8)
        // echo,10s, "hello","" -> ["echo","10s","hello",""]
        // command,10m, "plugin.install chatgpt" -> ["command","10m","plugin.install chatgpt"]

        const session = this.session

        let [type, interval, ...args] = input.split(',')

        args = args.map((arg) =>
            arg.includes('"') || arg.includes("'") ? arg.slice(1, -1) : arg
        )

        const command = this._generateCommand(type, interval, args)
        // command.session = this.session

        await session.send(
            `模型请求执行定时指令 ${
                command /* .source */
            }，如需同意，请输入以下字符：${validationString}`
        )
        const canRun = await this.session.prompt()

        if (canRun !== validationString) {
            await this.session.send('指令执行失败')
            return `The cron ${input} execution failed, because the user didn't confirm`
        }

        try {
            const result = await session.execute(command, true)
            await session.send(result)
            return result
        } catch (e) {
            return `The cron ${input} execution failed, because ${e.message}`
        }
    }

    private _generateCommand(type: string, interval: string, args: string[]) {
        if (type === 'command') {
            return `schedule ${interval} -- ${args[0]}`
        }

        const result = [`schedule ${interval} -- echo`]

        if (args[1] === 'group') {
            result.push(args[0])
            return result.join(' ')
        }

        if (args[1] == null) {
            args[1] = this.session.userId
        }

        result.push('-u')
        result.push('@' + args[1])
        result.push(args[0])

        return result.join(' ')
    }

    // eslint-disable-next-line max-len
    description = `This tool runs tasks periodically. Use the commands in the help to do many things.

    It takes four arguments, comma-separated. The first argument is the task type: "command" or "echo". command runs any command, echo shows a message.

    The second argument is the run time, with these rules:

    1m: run after 1 minute
    2h30m: run after 2 hours and 30 minutes
    10:00: run at 10:00 today
    1m / 10s: run every 10 seconds after 1 minute
    10:00 / 1d: run at 10pm every day from now on

    The third argument is the task content. For command, it's the command. For echo, it's the message. For example, "echo 122" or "time to eat".

    The fourth argument, only for echo, is the id of who to send the message. e.g. "10001". If it's empty, it's for the caller. If it's 'group', it's for the everyone or group.

    Some examples:

    echo,10s,"hello",""
    command,10m,"plugin.install chatgpt"`
}
