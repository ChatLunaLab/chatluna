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
    conversationId?: string
    history?: BaseMessage[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables?: Record<string, any>
    signal?: AbortSignal
    maxToken?: number
    messageQueue?: MessageQueue
    toolMask?: ToolMask
    subagentContext?: SubagentContext
    source?: 'chatluna' | 'character'
    onStep?: (event: AgentEvent) => Promise<void> | void
    onToken?: (token: string) => Promise<void> | void
    onChunk?: (chunk: BaseMessageChunk) => Promise<void> | void
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
            const vars = {
                ...(input.variables ?? {}),
                prompt: text,
                built: {
                    conversationId: input.conversationId,
                    session: input.session
                }
            }
            const toolMask =
                input.subagentContext?.toolMask ??
                input.toolMask ??
                options.toolMask

            toolsRef.update(input.session, history.concat(message), toolMask)

            const bound = runner.value.withConfig({
                configurable: {
                    messageQueue: input.messageQueue,
                    onAgentEvent: input.onStep
                }
            })

            return await bound.invoke(
                {
                    input: message,
                    chat_history: [...history],
                    variables: vars,
                    variables_hide: vars,
                    configurable: {
                        session: input.session,
                        conversationId: input.conversationId,
                        toolMask,
                        subagentContext: input.subagentContext
                    }
                },
                {
                    signal: input.signal,
                    callbacks: [
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
                    ],
                    configurable: {
                        session: input.session,
                        model: options.llm.value,
                        conversationId: input.conversationId,
                        preset: name,
                        userId: input.session?.userId,
                        toolMask,
                        subagentContext: input.subagentContext,
                        source: input.source
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
    if (preset) {
        return preset
    }

    return computed(
        () =>
            ({
                triggerKeyword: [name],
                rawText: system ?? '',
                messages: system ? [new SystemMessage(system)] : [],
                config: {}
            }) satisfies PresetTemplate
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
        input: {
            prompt: string
        },
        _: unknown,
        runConfig?: ChatLunaToolRunnable
    ) {
        const result = await this._agent.generate({
            prompt: input.prompt,
            session: runConfig?.configurable?.session,
            conversationId: runConfig?.configurable?.conversationId,
            toolMask: runConfig?.configurable?.toolMask,
            subagentContext: runConfig?.configurable?.subagentContext,
            signal: runConfig?.signal,
            source: (
                runConfig?.configurable as { source?: 'chatluna' | 'character' }
            )?.source
        })

        return result.output
    }
}

function createAsyncQueue<T>() {
    const values: T[] = []
    let done = false
    let error: unknown
    let wait = createWaiter()

    return {
        push(value: T) {
            if (done) {
                return
            }

            values.push(value)
            wait.resolve()
        },
        close() {
            done = true
            wait.resolve()
        },
        fail(err: unknown) {
            error = err
            done = true
            wait.resolve()
        },
        async *iterate(): AsyncGenerator<T> {
            while (true) {
                if (values.length > 0) {
                    yield values.shift()
                    continue
                }

                if (done) {
                    if (error) {
                        throw error
                    }

                    return
                }

                await wait.promise
                wait = createWaiter()
            }
        }
    }
}

function createWaiter() {
    let finish!: () => void
    const promise = new Promise<void>((resolve) => {
        finish = resolve
    })

    return {
        promise,
        resolve: finish
    }
}
