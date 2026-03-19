/** @module sub-agent/catalog */

import { Context } from 'koishi'
import { AgentConfig, ManualSubAgentInput } from '../types'
import { ChatLunaAgentPermissionService } from '../service/permissions'
import { applyShadowing } from '../utils/shadow'
import { createManualAgent } from './manual'
import { getPresetAgents } from './preset'
import { getBuiltinAgents, scanMarkdownAgents } from './scan'

export async function buildSubAgentCatalog(
    ctx: Context,
    cfg: AgentConfig['subAgent'],
    permission: ChatLunaAgentPermissionService,
    manual: Iterable<ManualSubAgentInput>
) {
    const items = [
        ...[...manual].map((item) => createManualAgent(ctx, item)),
        ...getBuiltinAgents(cfg),
        ...(await scanMarkdownAgents(ctx, cfg)),
        ...getPresetAgents(ctx, cfg)
    ].map((item) => ({
        ...item,
        permissions: permission.mergePermissions(item.permissions)
    }))

    return applyShadowing(items).sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return a.name.localeCompare(b.name)
    })
}
