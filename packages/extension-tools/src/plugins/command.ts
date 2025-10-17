/* eslint-disable max-len */

import { StructuredTool } from '@langchain/core/tools'
import { Context, h } from 'koishi'
import type { Command as CommandType } from '@satorijs/protocol'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent,
    isMessageContentImageUrl,
    isMessageContentText
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager'
import { randomUUID } from 'crypto'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.command !== true) {
        return
    }

    const commandList = getCommandList(
        ctx,
        config.commandList,
        config.commandBlacklist
    )

    for (const command of commandList) {
        const prompt = generateSingleCommandPrompt(command)
        const normalizedName = normalizeCommandName(command.name)

        plugin.registerTool(`command_execute_${normalizedName}`, {
            selector(history) {
                if (command.selector == null || command.selector.length === 0) {
                    return true
                }
                return history.some((item) => {
                    const content = getMessageContent(item.content)

                    return fuzzyQuery(content, [
                        '令',
                        '调用',
                        '获取',
                        'get',
                        'help',
                        'command',
                        '执行',
                        '用',
                        'execute',
                        ...command.name.split('.'),
                        ...(command.selector ?? [])
                    ])
                })
            },
            createTool(params) {
                return new CommandExecuteTool(
                    ctx,
                    `${normalizedName}`,
                    prompt,
                    command,
                    config.commandWithSend
                )
            }
        })
    }
}

function generateSingleCommandPrompt(command: PickCommandType): string {
    return `Tool Description: ${command.description || 'No description'}\n\n`
}

function getDescription(description: string | Record<string, string>): string {
    if (typeof description === 'string') {
        return description
    }

    return (
        description['zh-CN'] ||
        description[''] ||
        description['en-US'] ||
        'No description'
    )
}

function getCommandList(
    ctx: Context,
    rawCommandList: Config['commandList'],
    blacklist: Config['commandBlacklist'] = []
): PickCommandType[] {
    const commandMap = new Map(
        ctx.$commander._commandList
            .filter((item) => {
                // Filter out chatluna commands
                if (item.name.includes('chatluna')) {
                    return false
                }

                // Filter out blacklisted commands and their sub-commands
                for (const blocked of blacklist) {
                    // Check if command starts with blocked prefix (e.g., "command", "command.xxx")
                    if (
                        item.name === blocked ||
                        item.name.startsWith(blocked + '.')
                    ) {
                        return false
                    }
                }

                return true
            })
            .map((cmd) => [cmd.name, cmd.toJSON()])
    )

    // If rawCommandList is provided, map based on it
    if (rawCommandList.length > 0) {
        return rawCommandList
            .map((rawCommand) => {
                const item = commandMap.get(rawCommand.command)

                if (!item) {
                    ctx.logger.warn(
                        `Command "${rawCommand.command}" not found in command list`
                    )
                    return null
                }

                let description: string | CommandType['description'] =
                    rawCommand.description

                if (
                    (rawCommand.description?.length ?? 0) < 1 &&
                    item.description
                ) {
                    description = JSON.stringify(item.description)
                }

                return {
                    ...item,
                    selector: rawCommand.selector,
                    confirm: rawCommand.confirm ?? true,
                    description
                } satisfies PickCommandType
            })
            .filter((item) => item !== null)
    }

    // Otherwise, return all commands except chatluna
    return Array.from(commandMap.values()).map((item) => ({
        ...item,
        confirm: true,
        description:
            typeof item.description === 'string'
                ? item.description
                : JSON.stringify(item.description)
    }))
}

export class CommandExecuteTool extends StructuredTool {
    schema = z.object({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    constructor(
        public ctx: Context,
        public name: string,
        public description: string,
        private command: PickCommandType,
        private commandWithSend: boolean
    ) {
        super()

        this.schema = this.generateSchema()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private generateSchema(): z.ZodObject<any> {
        const schemaShape: Record<string, z.ZodTypeAny> = {}

        this.command.arguments.forEach((arg) => {
            const zodType = this.getZodType(arg.type)
            const description = getDescription(arg.description)
            const zodTypeWithDescription = zodType.describe(description)

            schemaShape[arg.name] = arg.required
                ? zodTypeWithDescription
                : zodTypeWithDescription.optional()
        })

        this.command.options.forEach((opt) => {
            if (opt.name !== 'help') {
                const zodType = this.getZodType(opt.type)
                const description = getDescription(opt.description)
                const zodTypeWithDescription = zodType.describe(description)

                schemaShape[opt.name] = opt.required
                    ? zodTypeWithDescription
                    : zodTypeWithDescription.optional()
            }
        })

        if (Object.keys(schemaShape).length < 1) {
            return z.object({
                input: z.string().optional().describe('Input for the command')
            })
        }

        return z.object(schemaShape)
    }

    private getZodType(type: string): z.ZodTypeAny {
        switch (type) {
            case 'text':
            case 'string':
            case 'date':
                return z.string()
            case 'integer':
            case 'posint':
            case 'natural':
            case 'number':
                return z.number()
            case 'boolean':
                return z.boolean()
            default:
                return z.string()
        }
    }

    /** @ignore */

    async _call(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: any,
        runManager: CallbackManagerForToolRun,
        config: ChatLunaToolRunnable
    ) {
        const koishiCommand = this.parseInput(input)

        const session = config.configurable.session

        if (this.command.confirm ?? true) {
            const validationString = randomString(8)

            await session.send(
                `模型请求执行指令 ${koishiCommand}，如需同意，请输入以下字符：${validationString}`
            )
            const canRun = await session.prompt()

            if (canRun !== validationString) {
                await session.send('指令执行失败')
                return `The command ${koishiCommand} execution failed, because the user didn't confirm`
            }
        }

        try {
            const result = await session.execute(koishiCommand, true)

            let commandWithSend = this.commandWithSend

            const transformedMessage =
                await this.ctx.chatluna.messageTransformer.transform(
                    session,
                    result,
                    ''
                )

            const content =
                typeof transformedMessage.content === 'string'
                    ? transformedMessage.content
                    : transformedMessage.content
                          .map((part) => {
                              if (isMessageContentText(part)) {
                                  return part.text
                              }
                              if (isMessageContentImageUrl(part)) {
                                  const imageUrl =
                                      typeof part.image_url === 'string'
                                          ? part.image_url
                                          : part.image_url.url

                                  if (imageUrl.includes('data:')) {
                                      commandWithSend = true
                                      return `[image:${imageUrl.substring(0, 12)}]`
                                  }

                                  return `[image:${imageUrl}] Please use ![image](url) send image to user`
                              }
                          })
                          .join('\n\n')

            if (commandWithSend) {
                await session.send(result)
            }

            return `Successfully executed command ${koishiCommand} with result: ${content}`
        } catch (e) {
            this.ctx.logger.error(e)
            return `The command ${koishiCommand} execution failed, because ${e.message}`
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private parseInput(input: Record<string, any>): string {
        try {
            const args: string[] = []
            const options: string[] = []

            // 处理参数
            this.command.arguments.forEach((arg) => {
                if (arg.name in input) {
                    args.push(String(input[arg.name]))
                }
            })

            // 处理选项
            this.command.options.forEach((opt) => {
                if (opt.name in input && opt.name !== 'help') {
                    if (opt.type === 'boolean') {
                        if (input[opt.name]) {
                            options.push(`--${opt.name}`)
                        }
                    } else {
                        options.push(`--${opt.name}`, String(input[opt.name]))
                    }
                }
            })

            // 构建完整的命令字符串
            const fullCommand = [this.command.name, ...args, ...options]
                .join(' ')
                .trim()

            return fullCommand
        } catch (error) {
            console.error('Failed to parse JSON input:', error)
            throw new Error('Invalid JSON input')
        }
    }
}

export function randomString(size: number) {
    let text = ''
    const possible =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < size; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length))
    return text
}

export function elementToString(elements: h[]) {
    return elements.map((h) => h.toString(true)).join('\n\n')
}

function normalizeCommandName(name: string): string {
    // Common Chinese to English mapping for command names
    const chineseToEnglish: Record<string, string> = {
        // Common command terms
        帮助: 'help',
        列表: 'list',
        查询: 'query',
        搜索: 'search',
        添加: 'add',
        删除: 'delete',
        修改: 'modify',
        更新: 'update',
        获取: 'get',
        设置: 'set',
        创建: 'create',
        移除: 'remove',
        显示: 'show',
        查看: 'view',
        编辑: 'edit',
        保存: 'save',
        加载: 'load',
        启动: 'start',
        停止: 'stop',
        重启: 'restart',
        状态: 'status',
        信息: 'info',
        配置: 'config',
        管理: 'manage',
        用户: 'user',
        消息: 'message',
        发送: 'send',
        接收: 'receive',
        清除: 'clear',
        重置: 'reset',
        导入: 'import',
        导出: 'export',
        测试: 'test',
        运行: 'run',
        执行: 'execute',
        调用: 'call',
        刷新: 'refresh',
        同步: 'sync',
        连接: 'connect',
        断开: 'disconnect',
        登录: 'login',
        登出: 'logout',
        注册: 'register',
        验证: 'verify',
        授权: 'authorize',
        禁用: 'disable',
        启用: 'enable',
        切换: 'toggle',
        复制: 'copy',
        粘贴: 'paste',
        剪切: 'cut',
        撤销: 'undo',
        重做: 'redo',
        分享: 'share',
        上传: 'upload',
        下载: 'download',
        安装: 'install',
        卸载: 'uninstall',
        备份: 'backup',
        恢复: 'restore',
        统计: 'stats',
        分析: 'analyze',
        报告: 'report',
        通知: 'notify',
        提醒: 'remind',
        订阅: 'subscribe',
        取消: 'cancel',
        确认: 'confirm',
        拒绝: 'reject',
        接受: 'accept',
        批准: 'approve',
        审核: 'review',
        检查: 'check',
        扫描: 'scan',
        过滤: 'filter',
        排序: 'sort',
        分组: 'group',
        合并: 'merge',
        拆分: 'split',
        转换: 'convert',
        翻译: 'translate',
        计算: 'calculate',
        比较: 'compare',
        匹配: 'match',
        替换: 'replace',
        插入: 'insert',
        追加: 'append',
        前置: 'prepend',
        打开: 'open',
        关闭: 'close',
        锁定: 'lock',
        解锁: 'unlock',
        隐藏: 'hide',
        展开: 'expand',
        折叠: 'collapse',
        最小化: 'minimize',
        最大化: 'maximize',
        全屏: 'fullscreen',
        退出: 'exit',
        返回: 'back',
        前进: 'forward',
        跳转: 'jump',
        导航: 'navigate',
        定位: 'locate',
        标记: 'mark',
        高亮: 'highlight',
        选择: 'select',
        取消选择: 'deselect',
        全选: 'selectall',
        反选: 'invert',
        预览: 'preview',
        打印: 'print',
        格式化: 'format',
        美化: 'beautify',
        压缩: 'compress',
        解压: 'decompress',
        加密: 'encrypt',
        解密: 'decrypt',
        签名: 'sign',
        验签: 'verifysign',
        哈希: 'hash',
        编码: 'encode',
        解码: 'decode',
        解析: 'parse',
        生成: 'generate',
        构建: 'build',
        编译: 'compile',
        部署: 'deploy',
        发布: 'publish',
        回滚: 'rollback',
        监控: 'monitor',
        调试: 'debug',
        日志: 'log',
        记录: 'record',
        追踪: 'trace',
        性能: 'performance',
        优化: 'optimize',
        清理: 'clean',
        维护: 'maintain',
        修复: 'fix',
        诊断: 'diagnose',
        健康: 'health',
        版本: 'version',
        关于: 'about',
        许可: 'license',
        文档: 'doc',
        示例: 'example',
        教程: 'tutorial',
        指南: 'guide',
        参考: 'reference',
        索引: 'index',
        目录: 'catalog',
        分类: 'category',
        标签: 'tag',
        评论: 'comment',
        回复: 'reply',
        点赞: 'like',
        收藏: 'favorite',
        关注: 'follow',
        推荐: 'recommend',
        排行: 'rank',
        热门: 'hot',
        最新: 'latest',
        随机: 'random'
    }

    let result = name

    // Replace Chinese characters with English equivalents
    for (const [chinese, english] of Object.entries(chineseToEnglish)) {
        result = result.replace(new RegExp(chinese, 'g'), english)
    }

    // Remove all non-alphanumeric characters except dots (for command hierarchy)
    result = result.replace(/[^a-zA-Z0-9.]/g, '')

    // If the result is empty or starts with a number, add a prefix
    if (result.length === 0 || /^[0-9]/.test(result)) {
        result =
            'cmd' +
            (result ||
                randomUUID()
                    .substring(0, 12)
                    .replace(/[^a-zA-Z0-9]/g, ''))
    }

    return result
}

type PickCommandType = Omit<CommandType, 'description'> & {
    description?: string
    selector?: string[]
    confirm?: boolean
}
