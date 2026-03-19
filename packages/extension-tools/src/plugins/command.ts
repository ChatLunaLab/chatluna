/* eslint-disable max-len */

import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager'
import { StructuredTool } from '@langchain/core/tools'
import type { Command as CommandType } from '@satorijs/protocol'
import { Context, h } from 'koishi'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import type {} from 'koishi-plugin-chatluna-agent'
import { z } from 'zod'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.command !== true) {
        await removeCommandSkill(ctx)
        return
    }

    const commandList = getCommandList(
        ctx,
        config.commandList,
        config.commandBlacklist
    )

    await syncCommandSkill(ctx, commandList, config.commandAutoExecute)

    plugin.registerTool('koishi_command_execute', {
        description: new CommandExecuteTool(
            ctx,
            commandList,
            config.commandWithSend,
            config.commandAutoExecute
        ).description,
        selector() {
            return true
        },
        createTool() {
            return new CommandExecuteTool(
                ctx,
                commandList,
                config.commandWithSend,
                config.commandAutoExecute
            )
        }
    })
}

function getDescription(description?: string | Record<string, string>): string {
    if (typeof description === 'string') {
        return description
    }

    if (!description) {
        return 'No description'
    }

    return (
        description['zh-CN'] ||
        description[''] ||
        description['en-US'] ||
        'No description'
    )
}

function cleanText(text: string) {
    return text.replace(/\s+/g, ' ').trim()
}

function getCommandList(
    ctx: Context,
    rawCommandList: Config['commandList'],
    blacklist: Config['commandBlacklist'] = []
): PickCommandType[] {
    const commandMap = new Map(
        ctx.$commander._commandList
            .filter((item) => {
                if (item.name.includes('chatluna')) {
                    return false
                }

                for (const blocked of blacklist) {
                    if (
                        item.name === blocked ||
                        item.name.startsWith(blocked + '.')
                    ) {
                        return false
                    }
                }

                return true
            })
            .map((cmd) => {
                const alias = cmd._aliases ? Object.keys(cmd._aliases) : []
                return [
                    cmd.name,
                    {
                        ...cmd.toJSON(),
                        alias
                    }
                ]
            })
    )

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

                const description =
                    rawCommand.description?.length > 0
                        ? rawCommand.description
                        : getDescription(item.description)

                return {
                    ...item,
                    selector: rawCommand.selector,
                    confirm: rawCommand.confirm ?? true,
                    description
                } satisfies PickCommandType
            })
            .filter((item) => item !== null)
    }

    return Array.from(commandMap.values()).map((item) => ({
        ...item,
        confirm: true,
        description: getDescription(item.description)
    }))
}

async function removeCommandSkill(ctx: Context) {
    await rm(
        join(ctx.baseDir, 'data/chatluna/skills', 'koishi_command_skills'),
        {
            recursive: true,
            force: true
        }
    )
}

async function syncCommandSkill(
    ctx: Context,
    commandList: PickCommandType[],
    commandAutoExecute: boolean
) {
    const tree = buildCommandTree(commandList)
    const skillDir = join(
        ctx.baseDir,
        'data/chatluna/skills',
        'koishi_command_skills'
    )
    const refsDir = join(skillDir, 'references')
    const refs = tree.map((node, idx) => ({
        description: cleanText(node.command?.description ?? 'Command group'),
        file: getReferenceFileName(node.name, idx),
        node
    }))

    await rm(skillDir, { recursive: true, force: true })
    await mkdir(refsDir, { recursive: true })

    await Promise.all([
        writeFile(
            join(skillDir, 'SKILL.md'),
            renderCommandSkill(tree, refs, commandAutoExecute)
        ),
        ...refs.map((item) =>
            writeFile(
                join(refsDir, item.file),
                renderCommandReference(item.node, commandAutoExecute)
            )
        )
    ])
}

function renderCommandSkill(
    tree: CommandNode[],
    refs: CommandSkillFile[],
    commandAutoExecute: boolean
) {
    const lines = [
        '---',
        'name: koishi_command_skills',
        'description: >',
        '  Use this skill when you need to run a Koishi command, inspect the real',
        '  Koishi command hierarchy, or handle a task that should go through',
        '  Koishi instead of bash or other shell commands. Read the matching',
        '  command reference, then execute the final command with',
        '  koishi_command_execute.',
        'allowed-tools: koishi_command_execute',
        '---',
        '',
        '# Koishi Command Skills',
        '',
        'This skill is auto-generated on startup from the current Koishi command registry.',
        '',
        '## When to use this skill',
        '',
        '- Use it when the task should be done with a Koishi command instead of `bash`.',
        '- Use it when you need the real command tree, subcommands, arguments, options, aliases, or help text.',
        '- After you find the right command, execute the final command string with `koishi_command_execute`.',
        commandAutoExecute
            ? '- This instance runs matching commands without the extra confirmation step.'
            : '- This instance may ask the user to confirm a command before it runs.',
        '',
        '## Workflow',
        '',
        '1. Match the request to the nearest top-level command below.',
        '2. Read the linked reference file for that command tree.',
        '3. If the exact syntax is still unclear, run `help` or `help <command>` with `koishi_command_execute`.',
        '4. Prefer the deepest subcommand that directly solves the task.',
        '5. Execute one complete Koishi command string with `koishi_command_execute`.'
    ]

    if (refs.length < 1) {
        lines.push(
            '',
            '## Available commands',
            '',
            'No Koishi commands are available in the current registry.'
        )
        return lines.join('\n') + '\n'
    }

    lines.push('', '## Top-level command references', '')

    for (const item of refs) {
        lines.push(
            `- \`${item.node.name}\`: ${item.description}. Read \`references/${item.file}\`.`
        )
    }

    lines.push(
        '',
        '## Command tree',
        '',
        '```text',
        ...renderCommandTree(tree),
        '```'
    )

    return lines.join('\n') + '\n'
}

function renderCommandReference(
    node: CommandNode,
    commandAutoExecute: boolean
) {
    const lines = [
        `# \`${node.name}\` command tree`,
        '',
        'This file lists the real Koishi hierarchy, descriptions, arguments, options, aliases, and confirmation behavior for this command tree.'
    ]

    pushCommandReference(lines, node, 0, commandAutoExecute)

    return lines.join('\n') + '\n'
}

function pushCommandReference(
    lines: string[],
    node: CommandNode,
    depth: number,
    commandAutoExecute: boolean
) {
    const level = '#'.repeat(Math.min(depth + 2, 6))
    const cmd = node.command

    lines.push('', `${level} \`${node.name}\``, '')

    if (cmd) {
        lines.push(
            `- Description: ${cleanText(cmd.description ?? 'No description')}`
        )
        lines.push(`- Syntax: \`${getCommandSyntax(cmd)}\``)

        if (cmd.alias && cmd.alias.length > 0) {
            lines.push(`- Aliases: ${formatItems(cmd.alias)}`)
        }

        if (cmd.selector && cmd.selector.length > 0) {
            lines.push(`- Typical intents: ${formatItems(cmd.selector)}`)
        }

        lines.push(
            `- Confirmation: ${commandAutoExecute || cmd.confirm === false ? 'No extra confirmation from the tool.' : 'The tool asks the user to confirm before running it.'}`
        )
    } else {
        lines.push(
            '- This path is a command group that only contains subcommands.'
        )
    }

    if (node.children.length > 0) {
        lines.push(
            `- Direct subcommands: ${formatItems(node.children.map((item) => item.name))}`
        )
    }

    if (cmd?.arguments.length) {
        lines.push('', '**Arguments**')

        for (const arg of cmd.arguments) {
            lines.push(
                `- \`${arg.name}\`${arg.required ? ' (required)' : ' (optional)'}: ${cleanText(getDescription(arg.description))}`
            )
        }
    }

    const opts = cmd?.options.filter((item) => item.name !== 'help') ?? []

    if (opts.length > 0) {
        lines.push('', '**Options**')

        for (const opt of opts) {
            lines.push(
                `- \`--${opt.name}\`${opt.required ? ' (required)' : ' (optional)'}: ${cleanText(getDescription(opt.description))}`
            )
        }
    }

    for (const child of node.children) {
        pushCommandReference(lines, child, depth + 1, commandAutoExecute)
    }
}

function buildCommandTree(commandList: PickCommandType[]) {
    const roots: CommandNode[] = []
    const map = new Map<string, CommandNode>()

    for (const cmd of commandList) {
        const parts = cmd.name.split('.')
        let current = ''
        let parent: CommandNode | undefined

        for (const part of parts) {
            current = current ? `${current}.${part}` : part
            let node = map.get(current)

            if (!node) {
                node = {
                    name: current,
                    children: []
                }
                map.set(current, node)

                if (parent) {
                    parent.children.push(node)
                } else {
                    roots.push(node)
                }
            }

            parent = node
        }

        if (parent) {
            parent.command = cmd
        }
    }

    sortCommandNodes(roots)
    return roots
}

function sortCommandNodes(nodes: CommandNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) {
        sortCommandNodes(node.children)
    }
}

function renderCommandTree(nodes: CommandNode[], depth = 0): string[] {
    const lines: string[] = []

    for (const node of nodes) {
        lines.push(`${'  '.repeat(depth)}- ${node.name}`)
        lines.push(...renderCommandTree(node.children, depth + 1))
    }

    return lines
}

function getReferenceFileName(name: string, idx: number) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

    return `${String(idx + 1).padStart(2, '0')}-${slug || 'command'}.md`
}

function formatItems(values: string[]) {
    return values.map((item) => `\`${item}\``).join(', ')
}

function getCommandSyntax(cmd: PickCommandType) {
    if (cmd.arguments.length < 1) {
        return cmd.name
    }

    return `${cmd.name} ${cmd.arguments.map((item) => item.name).join(' ')}`
}

export class CommandExecuteTool extends StructuredTool {
    name = 'koishi_command_execute'

    description =
        'Execute a Koishi command string. Use this instead of bash for Koishi commands.'

    schema = z.object({
        command: z
            .string()
            .describe(
                'Full Koishi command string, for example "help" or "weather beijing --unit celsius".'
            )
    })

    constructor(
        public ctx: Context,
        private commandList: PickCommandType[],
        private commandWithSend: boolean,
        private commandAutoExecute: boolean
    ) {
        super()
    }

    async _call(
        input: { command: string },
        runManager: CallbackManagerForToolRun,
        config: ChatLunaToolRunnable
    ): Promise<string> {
        const { command } = input

        if (!command || command.trim().length === 0) {
            return 'Error: Command string cannot be empty. Please provide a valid command.'
        }

        const baseCommandName = command.split(/\s+/)[0]
        const matchedCommand = this.commandList.find((cmd) => {
            if (
                cmd.name === baseCommandName ||
                cmd.name.startsWith(baseCommandName + '.') ||
                baseCommandName.startsWith(cmd.name + '.')
            ) {
                return true
            }

            if (cmd.alias && cmd.alias.length > 0) {
                return cmd.alias.some(
                    (alias) =>
                        alias === baseCommandName ||
                        alias.startsWith(baseCommandName + '.') ||
                        baseCommandName.startsWith(alias + '.')
                )
            }

            return false
        })

        const session = config.configurable.session

        if (!this.commandAutoExecute && (matchedCommand?.confirm ?? true)) {
            const validationString = randomString(8)

            await session.send(
                `模型请求执行指令 ${command}，如需同意，请输入以下字符：${validationString}`
            )
            const canRun = await session.prompt()

            if (canRun !== validationString) {
                await session.send('指令执行失败')
                return `The command ${command} execution failed, because the user didn't confirm`
            }
        }

        try {
            const result = await session.execute(command, true)

            let shouldSend = this.commandWithSend

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
                              if ('text' in part) {
                                  return part.text
                              }
                              if ('image_url' in part) {
                                  const imageUrl =
                                      typeof part.image_url === 'string'
                                          ? part.image_url
                                          : part.image_url.url

                                  if (imageUrl.includes('data:')) {
                                      shouldSend = true
                                      return `[image:${imageUrl.substring(0, 12)}]`
                                  }

                                  return `[image:${imageUrl}] Please use ![image](url) to send image to user`
                              }
                              return ''
                          })
                          .join('\n\n')

            if (shouldSend) {
                await session.send(result)
            }

            return `Successfully executed command "${command}".\nResult: ${content}`
        } catch (e) {
            this.ctx.logger.error(e)
            return `Failed to execute command "${command}". Error: ${e.message}`
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

interface CommandNode {
    name: string
    children: CommandNode[]
    command?: PickCommandType
}

interface CommandSkillFile {
    description: string
    file: string
    node: CommandNode
}

type PickCommandType = Omit<CommandType, 'description'> & {
    description?: string
    selector?: string[]
    confirm?: boolean
    alias?: string[]
}
