/** @module sub-agent/catalog */

import { Context } from 'koishi'
import { AgentConfig, ManualSubAgentInput, SubAgentInfo } from '../types'
import { ChatLunaAgentPermissionService } from '../service/permissions'
import { applyShadowing } from '../utils/shadow'
import { createManualAgent } from './manual'
import { getPresetAgents } from './preset'
import { getBuiltinAgents, scanMarkdownAgents } from './scan'

export async function buildSubAgentCatalog(
    ctx: Context,
    cfg: AgentConfig['subAgent'],
    permission: ChatLunaAgentPermissionService,
    manual: Iterable<ManualSubAgentInput>,
    extra: SubAgentInfo[] = []
) {
    return applyShadowing(
        [
            ...[...manual].map((item) => createManualAgent(ctx, item)),
            ...getBuiltinAgents(cfg),
            ...(await scanMarkdownAgents(ctx, cfg)),
            ...extra,
            ...getPresetAgents(ctx, cfg)
        ].map((item) => ({
            ...item,
            permissions: permission.mergePermissions(item.permissions)
        }))
    ).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}
