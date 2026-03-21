import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { Context } from 'koishi'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'

export async function apply(
    _ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.fileSender !== true) {
        return
    }

    const tool = new SendFileTool(config)

    plugin.registerTool(config.fileSenderToolName, {
        description: tool.description,
        selector() {
            return true
        },
        createTool() {
            return new SendFileTool(config)
        }
    })
}

type OneBotResponse = {
    file_id?: string
    data?: {
        file_id?: string
    }
}

type OneBotInternal = {
    _get?: (
        action: string,
        params: Record<string, unknown>
    ) => Promise<OneBotResponse>
    request?: (
        action: string,
        params: Record<string, unknown>
    ) => Promise<OneBotResponse>
    callAction?: (
        action: string,
        params: Record<string, unknown>
    ) => Promise<OneBotResponse>
    sendAction?: (
        action: string,
        params: Record<string, unknown>
    ) => Promise<OneBotResponse>
}

class SendFileTool extends StructuredTool {
    name = 'send_file'

    schema = z.object({
        file: z.string().min(1).optional(),
        name: z.string().optional(),
        files: z
            .array(
                z.union([
                    z.string(),
                    z.object({
                        file: z.string().min(1),
                        name: z.string().optional()
                    })
                ])
            )
            .optional()
    })

    constructor(private config: Config) {
        super({})
        this.name = config.fileSenderToolName
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _,
        runtime: ChatLunaToolRunnable
    ) {
        const session = runtime.configurable.session
        if (!session) {
            return '缺少会话上下文。'
        }

        if (session.platform === 'qq') {
            return 'QQ 官方 Bot 已禁用 send_file。'
        }

        if (session.platform !== 'onebot') {
            return '当前仅支持 OneBot 会话。'
        }

        const internal = (session.bot as { internal?: OneBotInternal }).internal
        if (!internal) {
            return '缺少 OneBot internal API 实例。'
        }

        const queue: { file: string; name: string }[] = []

        if (Array.isArray(input.files) && input.files.length > 0) {
            for (const item of input.files) {
                if (typeof item === 'string') {
                    const file = item.trim()
                    if (!file) continue
                    queue.push({
                        file,
                        name: getName(file, '')
                    })
                    continue
                }

                const file = item.file.trim()
                if (!file) continue
                queue.push({
                    file,
                    name: getName(file, item.name)
                })
            }
        } else {
            const file = input.file?.trim()
            if (!file) {
                return 'file 不能为空。'
            }
            queue.push({
                file,
                name: getName(file, input.name)
            })
        }

        if (queue.length < 1) {
            return '没有可上传的文件。'
        }

        const result: {
            file: string
            name: string
            fileId: string
            targetType: 'group' | 'private'
            targetId: string
        }[] = []

        for (const item of queue) {
            const file = item.file

            if (session.isDirect) {
                const data = await requestOnebot(
                    internal,
                    'upload_private_file',
                    {
                        user_id: Number(session.userId),
                        file,
                        name: item.name
                    },
                    this.config.fileSenderTimeout
                )

                result.push({
                    file: item.file,
                    name: item.name,
                    fileId:
                        String(
                            data?.file_id ?? data?.data?.file_id ?? ''
                        ).trim() || item.file,
                    targetType: 'private',
                    targetId: String(session.userId)
                })
                continue
            }

            const data = await requestOnebot(
                internal,
                'upload_group_file',
                {
                    group_id: Number(session.guildId ?? session.channelId),
                    file,
                    name: item.name
                },
                this.config.fileSenderTimeout
            )

            result.push({
                file: item.file,
                name: item.name,
                fileId:
                    String(data?.file_id ?? data?.data?.file_id ?? '').trim() ||
                    item.file,
                targetType: 'group',
                targetId: String(session.guildId ?? session.channelId)
            })
        }

        return JSON.stringify(
            {
                ok: true,
                count: result.length,
                files: result
            },
            null,
            2
        )
    }

    description = `发送 OneBot 文件消息，自动按当前会话上下文决定群聊或私聊。

参数：
- file: 单文件地址（URL、file://、base64://）
- name: 单文件名称（可选）
- files: 多文件列表，支持字符串或 { file, name }

说明：
- 支持一次提交多个文件，按顺序排队上传
- 群文件固定上传根目录
`
}

function getName(file: string, name?: string) {
    const input = (name ?? '').trim()
    if (input) {
        return input
    }

    try {
        const url = new URL(file)
        const part = decodeURIComponent(url.pathname.split('/').pop() ?? '')
        if (part) {
            return part
        }
    } catch {}

    const part = file.split(/[\\/]/).pop()?.trim()
    if (part) {
        return part
    }

    return 'file'
}

async function requestOnebot(
    internal: OneBotInternal,
    action: string,
    params: Record<string, unknown>,
    timeoutSeconds: number
) {
    const timeoutMs = timeoutSeconds * 1000

    const run = async () => {
        if (typeof internal._get === 'function') {
            return await internal._get(action, params)
        }
        if (typeof internal.request === 'function') {
            return await internal.request(action, params)
        }
        if (typeof internal.callAction === 'function') {
            return await internal.callAction(action, params)
        }
        if (typeof internal.sendAction === 'function') {
            return await internal.sendAction(action, params)
        }

        throw new Error(
            `OneBot internal API does not support action: ${action}`
        )
    }

    return await Promise.race<OneBotResponse>([
        run(),
        new Promise<OneBotResponse>((_resolve, reject) => {
            setTimeout(() => {
                reject(new Error(`${action} 请求超时，已超过 ${timeoutMs}ms。`))
            }, timeoutMs)
        })
    ])
}
