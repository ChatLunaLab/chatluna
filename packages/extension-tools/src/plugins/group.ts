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
        selector(history) {
            return true
        },
        authorization(session) {
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
        userId: z.string().describe('The user ID to mute'),
        muteTime: z
            .number()
            .describe(
                'Mute duration in seconds, minimum 1 seconds, 0 to unmute'
            ),
        operatorUserId: z
            .string()
            .optional()
            .describe(
                'The ID of the operator who initiated the action. Use 0 for model-initiated actions, -1 for unknown'
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
        let { userId, muteTime, operatorUserId } = input

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

        try {
            await bot.muteGuildMember(session.guildId, userId, muteTime * 1000)

            if (muteTime === 0) {
                return `Successfully unmuted user ${userId}.`
            } else {
                const minutes = Math.floor(muteTime / 60)
                const seconds = muteTime % 60
                const timeStr =
                    minutes > 0
                        ? seconds > 0
                            ? `${minutes}m ${seconds}s`
                            : `${minutes}m`
                        : `${seconds}s`
                return `Successfully muted user ${userId} for ${timeStr}.`
            }
        } catch (e) {
            return `Operation failed: ${e.message}`
        }
    }

    description = `Mutes or unmutes a user in the current group chat. This tool controls user speech permissions in the group.

Parameters:
- userId: The ID of the user to mute/unmute (string)
- muteTime: Duration in seconds. Use 0 to unmute, minimum 1 second for muting. Examples: 60 (1min), 300 (5min), 3600 (1hour)
- operatorUserId: IMPORTANT - The ID of who initiated this action:
  * Set to "0" when YOU (the AI model) decide to mute based on your own judgment, system prompts, or content moderation rules
  * Set to actual user ID when a user explicitly commands you to mute someone
  * Set to "-1" if unknown/unclear who initiated the action

CRITICAL: When you autonomously decide to mute someone (e.g., for spam, inappropriate content, rule violations), you MUST set operatorUserId to "0". Only use actual user IDs when the user explicitly requested the mute action.

Returns: Success message with duration details, or error message explaining why the operation failed.`
}
