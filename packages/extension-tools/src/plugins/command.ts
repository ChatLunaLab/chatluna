/* eslint-disable max-len */

import { StructuredTool } from '@langchain/core/tools'
import { Context, h } from 'koishi'
import type { Command as CommandType } from '@satorijs/protocol'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager'

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

    // Register the command search tool
    plugin.registerTool('command_search', {
        description: new CommandSearchTool(ctx, commandList).description,
        selector(history) {
            return true
        },
        createTool() {
            return new CommandSearchTool(ctx, commandList)
        }
    })

    // Register the command execute tool
    plugin.registerTool('command_execute', {
        description: new CommandExecuteTool(
            ctx,
            commandList,
            config.commandWithSend,
            config.commandAutoExecute
        ).description,
        selector(history) {
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
                const aliases = cmd._aliases ? Object.keys(cmd._aliases) : []
                return [
                    cmd.name,
                    {
                        ...cmd.toJSON(),
                        alias: aliases
                    }
                ]
            })
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

/**
 * Advanced matching algorithm that supports partial and fuzzy matching.
 * Examples:
 * - "shot" matches "screenshot" (substring match)
 * - "screen" matches "screenshot" (prefix match)
 * - "screenshot" matches "screenshot" (exact match)
 *
 * @param keyword - The search keyword
 * @param targets - Array of strings to match against (command name, aliases, description)
 * @returns Match score (higher is better, 0 means no match)
 */
function matchCommand(keyword: string, targets: string[]): number {
    const lowerKeyword = keyword.toLowerCase()
    let bestScore = 0

    for (const target of targets) {
        if (!target) continue
        const lowerTarget = target.toLowerCase()

        // Exact match (highest priority)
        if (lowerTarget === lowerKeyword) {
            bestScore = Math.max(bestScore, 100)
            continue
        }

        // Starts with match (high priority)
        if (lowerTarget.startsWith(lowerKeyword)) {
            bestScore = Math.max(bestScore, 80)
            continue
        }

        // Contains match (medium priority)
        if (lowerTarget.includes(lowerKeyword)) {
            bestScore = Math.max(bestScore, 60)
            continue
        }

        // Partial word match: keyword appears in any word of the target
        // Example: "shot" matches "screen-shot" or "take shot"
        const targetWords = lowerTarget.split(/[\s\-._]/)
        for (const word of targetWords) {
            if (word === lowerKeyword) {
                bestScore = Math.max(bestScore, 90)
                break
            }
            if (word.startsWith(lowerKeyword)) {
                bestScore = Math.max(bestScore, 70)
                break
            }
            if (word.includes(lowerKeyword)) {
                bestScore = Math.max(bestScore, 50)
                break
            }
        }

        // Reverse check: target is contained in keyword
        // Example: "screenshot" contains "shot"
        if (lowerKeyword.includes(lowerTarget)) {
            bestScore = Math.max(bestScore, 40)
        }
    }

    return bestScore
}

/**
 * Tool for searching and listing available Koishi commands.
 * Use this tool when the user or model needs to call a tool and the current
 * tools are insufficient to fully execute the request.
 */
export class CommandSearchTool extends StructuredTool {
    name = 'command_search'

    description = `Search and list available Koishi commands. Use this tool when the user or model needs to execute an action and the current tools are insufficient. This tool helps discover additional commands that can be executed using the command_execute tool.`

    schema = z.object({
        keywords: z
            .array(z.string())
            .optional()
            .describe(
                'Optional array of keywords to filter commands by name or description. Commands matching ANY keyword will be returned. Leave empty to list all available commands.'
            )
    })

    constructor(
        public ctx: Context,
        private commandList: PickCommandType[]
    ) {
        super()
    }

    async _call(input: { keywords?: string[] }): Promise<string> {
        const { keywords } = input
        let filteredCommands = this.commandList

        if (keywords && keywords.length > 0) {
            // Use the advanced matching algorithm with scoring
            const commandScores = this.commandList.map((cmd) => {
                let maxScore = 0

                // For each keyword, compute the best match score
                for (const keyword of keywords) {
                    // Build array of searchable targets: name, aliases, description
                    const targets = [
                        cmd.name,
                        ...(cmd.alias || []),
                        cmd.description || ''
                    ]

                    const score = matchCommand(keyword, targets)
                    maxScore = Math.max(maxScore, score)
                }

                return { command: cmd, score: maxScore }
            })

            // Filter commands with score > 0 and sort by score (descending)
            filteredCommands = commandScores
                .filter((item) => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((item) => item.command)
        }

        if (filteredCommands.length === 0) {
            return 'No commands found matching the keywords. Try different search terms or leave keywords empty to see all available commands.'
        }

        const commandDescriptions = filteredCommands.map((cmd) => {
            const desc = cmd.description || 'No description available'

            // Show aliases if they exist
            const aliasInfo =
                cmd.alias && cmd.alias.length > 0
                    ? `\nAliases: ${cmd.alias.join(', ')}`
                    : ''

            const args = cmd.arguments
                .map((arg) => {
                    const argDesc = getDescription(arg.description)
                    return `  - ${arg.name}${arg.required ? ' (required)' : ' (optional)'}: ${argDesc}`
                })
                .join('\n')

            const opts = cmd.options
                .filter((opt) => opt.name !== 'help')
                .map((opt) => {
                    const optDesc = getDescription(opt.description)
                    return `  - --${opt.name}${opt.required ? ' (required)' : ' (optional)'}: ${optDesc}`
                })
                .join('\n')

            let result = `Command: ${cmd.name}${aliasInfo}\nDescription: ${desc}`
            if (args) {
                result += `\nArguments:\n${args}`
            }
            if (opts) {
                result += `\nOptions:\n${opts}`
            }
            return result
        })

        return `Available commands (${filteredCommands.length} found):\n\n${commandDescriptions.join('\n\n---\n\n')}\n\nTo execute a command, use the command_execute tool with the full command string (e.g., "help", "echo hello", "command.subcommand --option value").`
    }
}

/**
 * Tool for executing Koishi commands.
 * Takes a plain text command string following Koishi command syntax.
 */
export class CommandExecuteTool extends StructuredTool {
    name = 'command_execute'

    description = `Execute a Koishi command. Input must be a valid command string following Koishi command syntax. Examples: "help", "echo hello world", "command.subcommand arg1 arg2 --option value". Use command_search first to discover available commands and their syntax.`

    schema = z.object({
        command: z
            .string()
            .describe(
                'The full command string to execute, following Koishi command syntax. Examples: "help", "echo hello", "weather beijing --unit celsius"'
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

        // Extract the base command name (first word before space or the entire string)
        const baseCommandName = command.split(/\s+/)[0]

        // Find the matching command configuration
        const matchedCommand = this.commandList.find((cmd) => {
            // Check if command name matches
            if (
                cmd.name === baseCommandName ||
                cmd.name.startsWith(baseCommandName + '.') ||
                baseCommandName.startsWith(cmd.name + '.')
            ) {
                return true
            }

            // Check if any alias matches
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

        // Check if confirmation is required
        // Skip confirmation if commandAutoExecute is enabled
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

type PickCommandType = Omit<CommandType, 'description'> & {
    description?: string
    selector?: string[]
    confirm?: boolean
    alias?: string[]
}
