/** @module sub-agent/markdown */

import { dump } from 'js-yaml'
import { ManualSubAgentInput } from '../types'

export function createSubAgentMarkdown(input: ManualSubAgentInput) {
    const prompt = input.promptContent?.trim()
    if (!prompt) {
        throw new Error('Sub-agent prompt content is empty')
    }

    return `---\n${dump(
        {
            name: input.name.trim(),
            description: input.description?.trim() || input.name.trim(),
            format: 'chatluna',
            enabled: input.enabled ?? true,
            chatluna: input.chatluna ?? true,
            character: input.character ?? true,
            characterGroup: input.characterGroup ?? true,
            characterPrivate: input.characterPrivate ?? true,
            characterGroupMode: input.characterGroupMode ?? 'all',
            characterPrivateMode: input.characterPrivateMode ?? 'all',
            characterGroupIds: input.characterGroupIds ?? [],
            characterPrivateIds: input.characterPrivateIds ?? [],
            authority: input.authority ?? 0,
            hidden: input.hidden ?? false,
            model: input.model,
            maxTurns: input.maxTurns,
            allowKoishiMessageTransform:
                input.allowKoishiMessageTransform ?? false,
            permissions: input.permissions
        },
        { lineWidth: 120, noRefs: true, skipInvalid: true }
    ).trimEnd()}\n---\n\n${prompt}\n`
}

export function getSubAgentFileName(name: string) {
    const result = name
        .replace(/\.md$/i, '')
        .trim()
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, '-')
    if (!result) throw new Error('Sub-agent file name is empty')
    return result
}
