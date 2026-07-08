import type { Embeddings } from '@langchain/core/embeddings'
import { computed, type ComputedRef } from '@vue/reactivity'
import type { ChatLunaChatPrompt } from '../chain/prompt'
import type {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from '../platform/model'
import type { ChatLunaTool } from '../platform/types'
import type { PresetTemplate } from '../prompt'
import { createPromptPreset } from './agent'
import type { ToolMask } from './types'

export interface CreateChatLunaAgentOptions {
    id?: string
    name?: string
    description?: string
    model:
        string | ChatLunaChatModel | ComputedRef<ChatLunaChatModel | undefined>
    embeddings?:
        string | ChatLunaBaseEmbeddings | ComputedRef<Embeddings | undefined>
    tools?: string[] | ChatLunaTool[] | ComputedRef<ChatLunaTool[]>
    mode?: 'tool-calling' | 'react'
    preset?: string | ComputedRef<PresetTemplate>
    system?: string
    prompt?: ChatLunaChatPrompt
    maxSteps?: number
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    instructions?: string | ComputedRef<string | undefined>
    returnIntermediateSteps?: boolean
    toolMask?: ToolMask
}

export async function resolveAgentModel(
    input: CreateChatLunaAgentOptions['model'],
    createChatModel: (
        fullModelName: string
    ) => Promise<ComputedRef<ChatLunaChatModel | undefined>>
) {
    if (typeof input === 'string') {
        const ref = await createChatModel(input)
        return computed(() => {
            if (!ref.value) {
                throw new Error(`Model not found: ${input}`)
            }

            return ref.value
        })
    }

    if ('value' in input) {
        return computed(() => {
            if (!input.value) {
                throw new Error('Model is not available')
            }

            return input.value
        })
    }

    return computed(() => input)
}

export async function resolveAgentEmbeddings(
    input: CreateChatLunaAgentOptions['embeddings'],
    createEmbeddings: (
        fullModelName: string
    ) => Promise<ComputedRef<Embeddings | undefined>>,
    fallback: string
) {
    if (input == null) {
        const ref = await createEmbeddings(fallback)
        return ref.value as ChatLunaBaseEmbeddings
    }

    if (typeof input === 'string') {
        const ref = await createEmbeddings(input)
        return ref.value as ChatLunaBaseEmbeddings
    }

    if ('value' in input) {
        return input.value as ChatLunaBaseEmbeddings
    }

    return input
}

export function resolveAgentTools(
    input: CreateChatLunaAgentOptions['tools'],
    getTool: (name: string) => ChatLunaTool
) {
    if (input == null || (Array.isArray(input) && input.length < 1)) {
        return computed(() => [] as ChatLunaTool[])
    }

    if ('value' in input) {
        return input
    }

    if (typeof input[0] === 'string') {
        return computed(() => (input as string[]).map((name) => getTool(name)))
    }

    return computed(() => input as ChatLunaTool[])
}

export function resolveAgentPreset(
    options: CreateChatLunaAgentOptions,
    getPreset: (name: string) => ComputedRef<PresetTemplate>
) {
    let presetRef: ComputedRef<PresetTemplate> | undefined
    if (typeof options.preset === 'string') {
        presetRef = getPreset(options.preset)
    } else {
        presetRef = options.preset
    }

    let instructions: ComputedRef<string | undefined> | undefined
    if (typeof options.instructions === 'string') {
        const text = options.instructions
        instructions = computed(() => text)
    } else {
        instructions = options.instructions
    }

    return {
        preset:
            options.system != null
                ? createPromptPreset(
                      options.name ?? 'agent',
                      options.system,
                      presetRef
                  )
                : (presetRef ?? createPromptPreset(options.name ?? 'agent')),
        instructions
    }
}
