/** @module sub-agent/preset */

import { Context } from 'koishi'
import { AgentConfig, SubAgentInfo } from '../types'

export function getPresetAgents(
    ctx: Context,
    cfg: AgentConfig['subAgent']
): SubAgentInfo[] {
    return Object.entries(cfg.presetAgents).map(([name, item], idx) => {
        const base = {
            id: `preset:${name}`,
            name,
            description: item.description,
            source: 'preset' as const,
            format: 'chatluna' as const,
            enabled: item.enabled,
            chatlunaEnabled: item.chatluna,
            characterEnabled: item.character,
            characterGroupEnabled: item.characterGroup,
            characterPrivateEnabled: item.characterPrivate,
            characterGroupMode: item.characterGroupMode,
            characterPrivateMode: item.characterPrivateMode,
            characterGroupIds: item.characterGroupIds,
            characterPrivateIds: item.characterPrivateIds,
            authority: item.authority,
            hidden: item.hidden ?? false,
            priority: 20 + idx,
            model: item.model,
            maxTurns: item.maxTurns,
            permissions: item.permissions,
            allowKoishiMessageTransform: item.allowKoishiMessageTransform,
            promptMode: 'preset' as const,
            preset: item.preset
        }

        try {
            const preset = item.preset
                ? ctx.chatluna.preset.getPreset(item.preset).value
                : undefined

            if (!preset) {
                return {
                    ...base,
                    state: 'missing' as const,
                    promptContent: '',
                    diagnostics: ['Referenced preset was not found']
                }
            }

            return {
                ...base,
                state: 'ready' as const,
                promptContent: preset.rawText,
                diagnostics: []
            }
        } catch (err) {
            return {
                ...base,
                state: 'missing' as const,
                promptContent: '',
                diagnostics: [err instanceof Error ? err.message : String(err)]
            }
        }
    })
}
