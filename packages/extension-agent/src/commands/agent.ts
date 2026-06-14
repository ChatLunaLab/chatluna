/** @module commands/agent */

import { Context } from 'koishi'
import { getErrorMessage } from '../utils/shell'

export function apply(ctx: Context) {
    ctx.command('chatluna.agent', 'ChatLuna agent admin commands', {
        authority: 1
    })

    ctx.command(
        'chatluna.agent.sync',
        'Sync the agentcli working copy back to the host config',
        {
            authority: 3
        }
    ).action(async () => {
        const service = ctx.chatluna_agent
        if (!service) {
            return 'ChatLuna agent service is not ready.'
        }

        try {
            const result = await service.syncAgentcliConfig()
            return `${result.applied ? 'agentcli sync: applied' : 'agentcli sync: no changes'}\n${result.message}`
        } catch (err) {
            return `agentcli sync failed: ${getErrorMessage(err)}`
        }
    })
}

export const inject = ['chatluna_agent']
