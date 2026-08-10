import type { Callbacks } from '@langchain/core/callbacks/manager'
import { CallbackManager } from '@langchain/core/callbacks/manager'
import {
    BaseMessage,
    BaseMessageChunk,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import { computed, type ComputedRef } from '@vue/reactivity'
import { randomUUID } from 'crypto'
import { type Session } from 'koishi'
import { z } from 'zod'
import type { ChatLunaChatPrompt } from '../chain/prompt'
import type {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import type {
    ChatLunaTool,
    ChatLunaToolRunnable
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { PresetTemplate } from '../prompt'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { createAgentRunner, createToolsRef } from './creator'
import type { AgentRunnerOutput } from './executor'
import type {
    AgentEvent,
    AgentRunContext,
    MessageQueue,
    SubagentContext,
    ToolMask
} from './types'

export interface CreateAgentOptions {
    id?: string
    name?: string
    description?: string
    llm: ComputedRef<ChatLunaChatModel>
    embeddings: ChatLunaBaseEmbeddings
    tools: ComputedRef<ChatLunaTool[]>
    prompt: ChatLunaChatPrompt
    mode?: 'tool-calling' | 'react'
    maxSteps?: number
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    instructions?: ComputedRef<string | undefined>
    returnIntermediateSteps?: boolean
    toolMask?: ToolMask
}

export interface AgentGenerateOptions {
    prompt: string | HumanMessage
    session?: Session
    conversationId: string
    requestId: string
    source?: 'chatluna' | 'character'
    history?: BaseMessage[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>
    signal?: AbortSignal
    maxToken?: number
    maxTokenLimit?: number
    messageQueue?: MessageQueue
    pauseGate?: (signal?: AbortSignal) => Promise<void>
    toolMask?: ToolMask
    subagentContext?: SubagentContext
    onStep?: (event: AgentEvent) => Promise<void> | void
    onToken?: (token: string) => Promise<void> | void
    onChunk?: (chunk: BaseMessageChunk) => Promise<void> | void
    callbacks?: Callbacks
}

export interface AgentStream {
    text: AsyncIterable<string>
    steps: AsyncIterable<AgentEvent>
    result: Promise<AgentRunnerOutput>
}

export interface AgentToolOptions {
    name?: string
    description?: string
}

export interface ChatLunaAgent {
    id: string
    name: string
    description: string
    generate(input: AgentGenerateOptions): Promise<AgentRunnerOutput>
    stream(input: AgentGenerateOptions): Promise<AgentStream>
    asTool(options?: AgentToolOptions): StructuredTool
}

export interface CreateAgentToolOptions extends AgentToolOptions {
    schema?: z.ZodTypeAny
}

export function createAgent(options: CreateAgentOptions): ChatLunaAgent {
    const id = options.id ?? randomUUID()
    const name = options.name ?? id
    const description = options.description ?? ''
    const mode = options.mode ?? 'tool-calling'
    const toolsRef = createToolsRef({
        tools: options.tools,
        embeddings: options.embeddings,
        toolMask: options.toolMask
    })
    const runner = createAgentRunner({
        llm: options.llm,
        tools: toolsRef.tools,
        prompt: options.prompt,
        agentMode: mode,
        maxIterations: options.maxSteps,
        returnIntermediateSteps: options.returnIntermediateSteps,
        handleParsingErrors: options.handleParsingErrors,
        instructions: options.instructions
    })

    const agent: ChatLunaAgent = {
        id,
        name,
        description,
        async generate(input) {
            const message =
                typeof input.prompt === 'string'
                    ? new HumanMessage(input.prompt)
                    : input.prompt
            const text = getMessageContent(message.content)
            const history = input.history ?? []
            const ctx = {
                kind: input.subagentContext ? 'subagent' : 'main',
                agentId: id,
                agentName: name,
                conversationId: input.conversationId,
                requestId: input.requestId,
                source: input.source ?? 'chatluna',
                userId: input.session?.userId,
                guildId: input.session?.guildId,
                channelId: input.session?.channelId,
                toolMask: options.toolMask ?? input.toolMask,
                subagentContext: input.subagentContext
            } satisfies AgentRunContext
            const maxTokens =
                input.maxToken ??
                options.prompt.preset.value.config.maxOutputToken
            const vars = {
                ...(input.variables ?? {}),
                prompt: text,
                built: {
                    conversationId: ctx.conversationId,
                    requestId: ctx.requestId,
                    userId: ctx.userId,
                    guildId: ctx.guildId,
                    channelId: ctx.channelId,
                    chatPlatform: input.session?.platform
                }
            }

            toolsRef.update(
                input.session,
                history.concat(message),
                ctx.toolMask
            )

            const bound = runner.value.withConfig({
                configurable: {
                    messageQueue: input.messageQueue,
                    pauseGate: input.pauseGate,
                    onAgentEvent: input.onStep,
                    agentContext: ctx
                }
            })

            return await bound.invoke(
                {
                    input: message,
                    chat_history: [...history],
                    maxTokens,
                    maxTokenLimit: input.maxTokenLimit,
                    variables: vars,
                    variables_hide: vars,
                    configurable: {
                        session: input.session,
                        agentContext: ctx
                    }
                },
                {
                    signal: input.signal,
                    callbacks: CallbackManager.configure(
                        input.callbacks,
                        CallbackManager.fromHandlers({
                            async handleLLMNewToken(token) {
                                await input.onToken?.(token)
                            },
                            async handleCustomEvent(name, data) {
                                if (name === 'LLMNewChunk') {
                                    await input.onChunk?.(
                                        data as BaseMessageChunk
                                    )
                                }
                            }
                        })
                    ),
                    metadata: { chatlunaAgent: ctx },
                    configurable: {
                        session: input.session,
                        model: options.llm.value,
                        preset: name,
                        agentContext: ctx
                    }
                } as ChatLunaToolRunnable
            )
        },
        async stream(input) {
            const text = createAsyncQueue<string>()
            const steps = createAsyncQueue<AgentEvent>()
            const result = agent
                .generate({
                    ...input,
                    onToken: async (token) => {
                        text.push(token)
                        await input.onToken?.(token)
                    },
                    onStep: async (event) => {
                        steps.push(event)
                        await input.onStep?.(event)
                    }
                })
                .then((res) => {
                    text.close()
                    steps.close()
                    return res
                })
                .catch((err) => {
                    text.fail(err)
                    steps.fail(err)
                    throw err
                })

            return {
                text: text.iterate(),
                steps: steps.iterate(),
                result
            }
        },
        asTool(toolOptions) {
            return createAgentTool(agent, toolOptions)
        }
    }

    return agent
}

export function createAgentTool(
    agent: ChatLunaAgent,
    options: CreateAgentToolOptions = {}
): StructuredTool {
    return new AgentTool({
        agent,
        name: options.name ?? agent.name,
        description:
            (options.description ?? agent.description) ||
            `Delegate work to ${agent.name}.`,
        schema:
            options.schema ??
            z.object({
                prompt: z
                    .string()
                    .describe('The complete task to delegate to this agent')
            })
    })
}

export function createPromptPreset(
    name: string,
    system?: string,
    preset?: ComputedRef<PresetTemplate>
): ComputedRef<PresetTemplate> {
    return (
        preset ??
        computed(
            () =>
                ({
                    triggerKeyword: [name],
                    rawText: system ?? '',
                    messages: system ? [new SystemMessage(system)] : [],
                    config: {}
                }) satisfies PresetTemplate
        )
    )
}

class AgentTool extends StructuredTool {
    name: string
    description: string
    schema: z.ZodTypeAny

    private _agent: ChatLunaAgent

    constructor(fields: {
        agent: ChatLunaAgent
        name: string
        description: string
        schema: z.ZodTypeAny
    }) {
        super()
        this._agent = fields.agent
        this.name = fields.name
        this.description = fields.description
        this.schema = fields.schema
    }

    async _call(
        input: { prompt: string },
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const parent = runConfig?.configurable?.agentContext
        if (!parent) throw new Error('Agent execution context is required')
        const runId = randomUUID()
        const parentSub = parent.subagentContext
        const depth = (parentSub?.depth ?? 0) + 1
        const maxDepth = parentSub?.maxDepth ?? 1
        if (parentSub?.disableHandoff || depth > maxDepth) {
            throw new Error(`Maximum sub-agent depth ${maxDepth} reached`)
        }

        const subagentContext: SubagentContext = {
            parentConversationId: parent.conversationId,
            depth,
            maxDepth,
            disableHandoff: depth >= maxDepth,
            traceInfo: {
                runId,
                parentAgent: parent.agentName,
                startedAt: Date.now(),
                parentRequestId: parent.requestId
            }
        }

        const result = await this._agent.generate({
            prompt: input.prompt,
            session: runConfig?.configurable?.session,
            conversationId: `subagent:${runId}`,
            requestId: runId,
            source: parent.source,
            toolMask: parent.toolMask,
            subagentContext,
            signal: runConfig?.signal,
            callbacks: runConfig?.callbacks
        })

        return result.output
    }
}

function createAsyncQueue<T>() {
    const queue: T[] = []
    let done = false
    let error: unknown
    let nextResolve: (() => void) | null = null

    return {
        push(value: T) {
            if (done) return
            queue.push(value)
            nextResolve?.()
        },
        close() {
            done = true
            nextResolve?.()
        },
        fail(err: unknown) {
            error = err
            done = true
            nextResolve?.()
        },
        async *iterate(): AsyncGenerator<T> {
            while (true) {
                if (queue.length > 0) {
                    yield queue.shift()!
                    continue
                }
                if (done) {
                    if (error) throw error
                    return
                }
                await new Promise<void>((resolve) => {
                    nextResolve = resolve
                })
                nextResolve = null
            }
        }
    }
}
