/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { Config } from '..'
import { z } from 'zod'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.group !== true) {
        return
    }

    plugin.registerTool('group_mute', {
        description: new GroupMuteTool(config).description,
        selector(history) {
            return true
        },
        meta: {
            source: 'extension',
            group: 'plugin-common',
            tags: ['plugin-common', 'group', 'moderation'],
            defaultAvailability: {
                enabled: true,
                main: true,
                chatluna: true,
                characterScope: 'group'
            }
        },
        authorization(session) {
            if (session.isDirect) {
                return false
            }
            // Check if group whitelist is enabled
            if (config.groupWhitelist && config.groupWhitelist.length > 0) {
                // Only allow in whitelisted groups
                const groupId = session.guildId || session.event.guild?.id
                if (!groupId || !config.groupWhitelist.includes(groupId)) {
                    return false
                }
            }
            return true
        },
        createTool(params) {
            return new GroupMuteTool(config)
        }
    })
}

export class GroupMuteTool extends StructuredTool {
    name = 'group_mute'

    schema = z.object({
        userIds: z
            .array(z.string())
            .describe('User IDs to mute or unmute, one or more.'),
        muteTime: z.number().describe('Duration in seconds. Use 0 to unmute.'),
        operatorUserId: z
            .string()
            .optional()
            .describe(
                'The ID of the person who asked for this mute action. Use "0" when you decide to mute on your own. Use the actual user ID when a user explicitly asks you to mute someone else. If a user asks you to mute themselves, also use "0". Use "-1" only when the requester is unclear. If the tool says a user does not have permission, it means this requester does not have permission to ask for the mute.'
            )
    })

    constructor(public config: Config) {
        super({})
    }

    /** @ignore */
    async _call(
        input: z.infer<typeof this.schema>,
        _,
        config: ChatLunaToolRunnable
    ) {
        let { userIds, muteTime, operatorUserId } = input

        const session = config.configurable.session

        if (operatorUserId === '-1') {
            operatorUserId = session.userId
        }

        if (
            operatorUserId !== '0' &&
            !this.config.groupScopeSelector.includes(operatorUserId)
        ) {
            return `Operation failed: User ${operatorUserId} does not have permission to mute users in this group.`
        }

        if (muteTime < 0) {
            return `Operation failed: Invalid mute time ${muteTime}. Use 0 to unmute, minimum 1 seconds for muting.`
        }

        const bot = session.bot
        const results: string[] = []

        let timeStr: string
        if (muteTime > 0) {
            const minutes = Math.floor(muteTime / 60)
            const seconds = muteTime % 60
            timeStr =
                minutes > 0
                    ? seconds > 0
                        ? `${minutes}m ${seconds}s`
                        : `${minutes}m`
                    : `${seconds}s`
        }

        for (const userId of userIds) {
            try {
                await bot.muteGuildMember(
                    session.guildId,
                    userId,
                    muteTime * 1000
                )
                if (muteTime === 0) {
                    results.push(`Successfully unmuted user ${userId}.`)
                } else {
                    results.push(
                        `Successfully muted user ${userId} for ${timeStr}.`
                    )
                }
            } catch (e) {
                results.push(
                    `Failed to ${muteTime === 0 ? 'unmute' : 'mute'} user ${userId}: ${e.message}`
                )
            }
        }

        return results.join('\n')
    }

    description = `Mute or unmute one or more users in the current group chat. Returns one result line per target user.`
}
