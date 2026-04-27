/** @module commands/agent */

import { Context } from 'koishi'
import { getErrorMessage } from '../utils/shell'

export function apply(ctx: Context) {
    ctx.command('chatluna.agent', 'ChatLuna agent admin commands', {
        authority: 3
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
            const header = result.applied
                ? 'agentcli sync: applied'
                : 'agentcli sync: no changes'
            return `${header}\n${result.message}`
        } catch (err) {
            const msg = getErrorMessage(err) || String(err) || 'unknown error'
            return `agentcli sync failed: ${msg}`
        }
    })
}

export const inject = ['chatluna_agent']
