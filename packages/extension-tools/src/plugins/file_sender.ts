import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { Context, h } from 'koishi'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'

export async function apply(
    _ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.fileSender !== true) {
        return
    }

    plugin.registerTool(config.fileSenderToolName, {
        description: new SendFileTool(config).description,
        selector() {
            return true
        },
        meta: {
            source: 'extension',
            group: 'plugin-common',
            tags: ['plugin-common', 'file', 'onebot'],
            defaultMain: true,
            defaultChatluna: true,
            defaultCharacter: false,
            defaultCharacterGroup: false,
            defaultCharacterPrivate: false
        },
        authorization(session) {
            return session.platform === 'onebot'
        },
        createTool() {
            return new SendFileTool(config)
        }
    })
}
class SendFileTool extends StructuredTool {
    name = 'send_file'

    schema = z
        .object({
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
        .superRefine((input, ctx) => {
            const hasFile = Boolean(input.file?.trim())
            const hasFiles =
                Array.isArray(input.files) && input.files.length > 0
            if (!hasFile && !hasFiles) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "'file' 或 'files' 至少提供一个。"
                })
                return
            }
            if (hasFile && hasFiles) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "'file' 与 'files' 不能同时提供。"
                })
            }
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

        if (session.platform !== 'onebot') {
            return '当前仅支持 OneBot 会话。'
        }

        const result: SendFileResult[] = []

        const type = session.isDirect ? 'private' : 'group'
        const target = session.isDirect
            ? session.userId
            : (session.guildId ?? session.channelId)
        const onebotAction = session.isDirect
            ? 'upload_private_file'
            : 'upload_group_file'

        for (const item of queue) {
            const file = item.file
            const error = validateFile(file)
            if (error) {
                result.push({
                    file,
                    name: item.name,
                    fileId: '',
                    targetType: type,
                    targetId: String(target),
                    error
                })
                continue
            }

            try {
                let data: { file_id?: string; data?: { file_id?: string } }

                if (session.platform === 'onebot') {
                    data = await requestOnebot(
                        (session.bot as OneBotBot<Context>).internal,
                        onebotAction,
                        session.isDirect
                            ? {
                                  user_id: Number(target),
                                  file,
                                  name: item.name
                              }
                            : {
                                  group_id: Number(target),
                                  file,
                                  name: item.name
                              },
                        this.config.fileSenderTimeout
                    )
                } else {
                    data = {
                        file_id: (await session.send(h.file(file)))[0]
                    }
                }

                result.push({
                    file,
                    name: item.name,
                    fileId: String(
                        data.data?.file_id || data.file_id || ''
                    ).trim(),
                    targetType: type,
                    targetId: String(target)
                })
            } catch (err) {
                result.push({
                    file,
                    name: item.name,
                    fileId: '',
                    targetType: type,
                    targetId: String(target),
                    error: String(err)
                })
            }
        }

        return JSON.stringify(
            {
                ok: result.every((item) => item.error === undefined),
                count: result.length,
                files: result
            },
            null,
            2
        )
    }

    description = `发送 OneBot 文件消息，自动按当前会话上下文决定群聊或私聊。

参数：
- file: 单文件地址（http/https URL、base64://）
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

    if (file.startsWith('base64://')) {
        return 'file'
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

function validateFile(file: string) {
    if (file.startsWith('base64://')) {
        return ''
    }

    try {
        const url = new URL(file)
        if (url.protocol === 'file:') {
            return '不允许 file:// 来源。'
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '仅支持 http/https/base64 来源。'
        }
        const host = url.hostname.toLowerCase()
        if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
        ) {
            return '不允许访问内网或本地地址。'
        }
        return ''
    } catch {
        return '仅支持 http/https/base64 来源。'
    }
}

function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
        )
    ])
}

async function requestOnebot(
    internal: OneBotBot<Context>['internal'],
    action: string,
    params: Record<string, unknown>,
    timeoutSeconds: number
) {
    const timeoutMs = timeoutSeconds * 1000

    const run = async () => {
        return (await internal._request(action, params)).data as OneBotResponse
    }

    return withTimeout(run(), timeoutMs)
}

type OneBotResponse = {
    status?: 'ok' | 'failed'
    retcode?: number
    file_id?: string
    data?: {
        file_id?: string
    }
    message?: string
    wording?: string
    stream?: string
}

type SendFileResult = {
    file: string
    name: string
    fileId: string
    targetType: 'group' | 'private'
    targetId: string
    error?: string
}
