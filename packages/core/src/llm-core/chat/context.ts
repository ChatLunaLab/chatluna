import { createHash } from 'node:crypto'
import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages'
import type {
    ChatLunaChatModel,
    ChatLunaModelCallOptions
} from '../platform/model'
import { formatFunctionDefinitions } from '../utils/function_def'
import {
    compactContext,
    type CompactionResult,
    contextBudget
} from './compaction'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

export interface ContextState {
    history: BaseMessage[]
    autoCompactWindow?: number | 'auto'
    onCompact?: (result: CompactionResult) => Promise<void>
    usage?: { fingerprint: string; count: number; tokens: number }
}

function fingerprint(messages: BaseMessage[], model: string, tools: string) {
    const hash = createHash('sha256').update(model).update(tools)
    for (const msg of messages) {
        hash.update(
            JSON.stringify([
                msg.getType(),
                msg.name,
                msg.content,
                (msg as AIMessage).tool_calls,
                msg.additional_kwargs,
                (msg as ToolMessage).tool_call_id
            ])
        )
    }
    return hash.digest('hex')
}

export function recordContextUsage(
    messages: BaseMessage[],
    model: ChatLunaChatModel,
    opts: ChatLunaModelCallOptions,
    tokens: number
) {
    const state = opts.configurable?.context as ContextState | undefined
    if (!state || tokens <= 0) return
    const tools = opts.tools?.length
        ? formatFunctionDefinitions(opts.tools)
        : ''
    state.usage = {
        fingerprint: fingerprint(messages, model.modelName, tools),
        count: messages.length,
        tokens
    }
}

export async function prepareContext(
    messages: BaseMessage[],
    model: ChatLunaChatModel,
    opts: ChatLunaModelCallOptions,
    force = false
): Promise<[BaseMessage[], number]> {
    const state = opts.configurable?.context as ContextState | undefined
    const budget = contextBudget(model, {
        ...opts,
        autoCompactWindow: state?.autoCompactWindow
    })
    const tools = opts.tools?.length
        ? formatFunctionDefinitions(opts.tools)
        : ''
    let tokens = 3 + (tools ? (await model.getNumTokens(tools)) + 9 : 0)
    const counts: number[] = []
    for (const msg of messages) {
        const count = await model.countMessageTokens(msg)
        counts.push(count)
        tokens += count
    }
    let estimate = tokens
    if (
        state?.usage &&
        state.usage.count <= messages.length &&
        state.usage.fingerprint ===
            fingerprint(
                messages.slice(0, state.usage.count),
                model.modelName,
                tools
            )
    ) {
        estimate = Math.max(
            tokens,
            state.usage.tokens +
                counts
                    .slice(state.usage.count)
                    .reduce((sum, count) => sum + count, 0)
        )
    }
    if (state) {
        const history = new Set(state.history)
        let reserved = tokens
        for (let idx = 0; idx < messages.length; idx++) {
            if (history.has(messages[idx])) reserved -= counts[idx]
        }
        const result = await compactContext({
            messages: state.history,
            model,
            conversationId: opts.id,
            maxContextWindow: opts.maxContextWindow,
            autoCompactWindow: state.autoCompactWindow,
            maxTokens: opts.maxTokens,
            reservedTokens: reserved,
            force: force || estimate > budget.threshold,
            signal: opts.signal
        })
        if (result.compressed) {
            await state.onCompact?.(result)
            const removed = new Set(result.removed)
            let inserted = false
            messages = messages.flatMap((msg) => {
                if (!removed.has(msg)) return [msg]
                if (inserted) return []
                inserted = true
                return [result.summary]
            })
            state.history.splice(0, state.history.length, ...result.messages)
            state.usage = undefined
            tokens = reserved + result.outputTokens
            estimate = tokens
        } else if (force) {
            throw new Error(
                'No history can be compacted after a context overflow'
            )
        }
    }
    if (estimate + budget.output > budget.limit) {
        throw new ChatLunaError(
            ChatLunaErrorCode.API_REQUEST_TOKEN_LIMIT,
            new Error(
                `Context needs ${estimate} input + ${budget.output} output tokens; window is ${budget.limit}`
            )
        )
    }
    return [messages, tokens]
}

export function isContextOverflow(error: unknown): boolean {
    const seen = new Set<unknown>()
    while (error instanceof Error && !seen.has(error)) {
        seen.add(error)
        if (
            error instanceof ChatLunaError &&
            error.errorCode === ChatLunaErrorCode.API_REQUEST_TOKEN_LIMIT
        )
            return true
        if (
            /context_length_exceeded|maximum context length|context window.{0,40}exceed|prompt is too long|input.{0,30}token.{0,30}exceed/i.test(
                error.message
            )
        )
            return true
        error = error instanceof ChatLunaError ? error.originError : error.cause
    }
    return false
}
