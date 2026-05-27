/** @module sub-agent/manual */

import { randomUUID } from 'crypto'
import { Context } from 'koishi'
import { createSubAgentItemConfig } from '../config/defaults'
import { ManualSubAgentInput, SubAgentInfo } from '../types'

export function createManualAgent(
    ctx: Context,
    input: ManualSubAgentInput
): SubAgentInfo {
    const item = createSubAgentItemConfig({
        enabled: input.enabled,
        name: input.name,
        description: input.description ?? input.name,
        chatluna: input.chatluna,
        character: input.character,
        characterGroup: input.characterGroup,
        characterPrivate: input.characterPrivate,
        characterGroupMode: input.characterGroupMode,
        characterPrivateMode: input.characterPrivateMode,
        characterGroupIds: input.characterGroupIds,
        characterPrivateIds: input.characterPrivateIds,
        authority: input.authority,
        source: 'manual',
        format: input.format ?? 'chatluna',
        model: input.model,
        maxTurns: input.maxTurns,
        hidden: input.hidden,
        promptMode: input.promptMode ?? (input.preset ? 'preset' : 'markdown'),
        preset: input.preset,
        allowKoishiMessageTransform: input.allowKoishiMessageTransform,
        permissions: input.permissions
    })

    const base: SubAgentInfo = {
        id: input.id?.trim() || `manual:${randomUUID()}`,
        name: item.name,
        description: item.description,
        source: 'manual',
        format: item.format,
        state: 'ready',
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
        priority: input.priority ?? -10,
        promptContent: '',
        model: item.model,
        maxTurns: item.maxTurns,
        permissions: item.permissions,
        allowKoishiMessageTransform: item.allowKoishiMessageTransform,
        diagnostics: [],
        promptMode: item.promptMode,
        preset: item.preset
    }

    if (item.promptMode === 'preset') {
        const preset = item.preset
            ? ctx.chatluna.preset.getPreset(item.preset).value
            : undefined

        if (!preset) {
            return {
                ...base,
                state: 'missing',
                diagnostics: ['Referenced preset was not found']
            }
        }

        return { ...base, promptContent: preset.rawText }
    }

    const content = input.promptContent ?? ''
    return {
        ...base,
        state: content.trim() ? 'ready' : 'invalid',
        promptContent: content,
        diagnostics: content.trim() ? [] : ['Prompt content is empty']
    }
}
