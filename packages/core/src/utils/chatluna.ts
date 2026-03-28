import { SystemMessage } from '@langchain/core/messages'
import { computed, type ComputedRef } from '@vue/reactivity'
import type { Context } from 'koishi'
import { ChatLunaChatPrompt } from 'koishi-plugin-chatluna/llm-core/chain/prompt'
import type { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import type { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'

export interface ComputePresetOptions {
    name: string
    promptMode?: 'markdown' | 'preset'
    preset?: string
}

export function computePreset(
    ctx: Context,
    info: ComputePresetOptions,
    rawText: string
): ComputedRef<PresetTemplate> {
    return computed(
        () =>
            ({
                triggerKeyword: [info.name],
                rawText,
                messages: rawText ? [new SystemMessage(rawText)] : [],
                config:
                    info.promptMode === 'preset' && info.preset
                        ? (ctx.chatluna.preset.getPreset(info.preset).value
                              ?.config ?? {})
                        : {}
            }) satisfies PresetTemplate
    )
}

export function createChatPrompt(
    ctx: Context,
    llm: ChatLunaChatModel,
    preset: ComputedRef<PresetTemplate>
): ChatLunaChatPrompt {
    return new ChatLunaChatPrompt({
        preset,
        tokenCounter: (text) => llm.getNumTokens(text),
        sendTokenLimit:
            llm.invocationParams().maxTokenLimit ??
            llm.getModelMaxContextSize(),
        contextManager: ctx.chatluna.contextManager,
        promptRenderService: ctx.chatluna.promptRenderer
    })
}
