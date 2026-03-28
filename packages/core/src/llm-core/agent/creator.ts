import { computed, ComputedRef, shallowRef } from '@vue/reactivity'
import {
    ChatLunaBaseEmbeddings,
    type ChatLunaChatModel
} from '../platform/model'
import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaChatPrompt } from '../chain/prompt'
import { createReactAgent } from './react'
import { createOpenAIAgent } from './openai'
import { ChatLunaTool } from '../platform/types'
import { BaseMessage } from '@langchain/core/messages'
import { Session } from 'koishi'
import type { Runnable } from '@langchain/core/runnables'
import { AgentRunner } from './executor'
import { applyToolMask, ToolMask } from './types'

export interface CreateAgentConfigOptions {
    llm: ComputedRef<ChatLunaChatModel>
    tools: ComputedRef<StructuredTool[]>

    prompt: ChatLunaChatPrompt
    agentMode: 'react' | 'tool-calling'
    instructions?: ComputedRef<string | undefined>
}

export interface AgentConfig {
    agent: Runnable
    tools: StructuredTool[]
    agentMode: 'react' | 'tool-calling'
}

export interface CreateAgentRunnerOptions {
    llm: ComputedRef<ChatLunaChatModel>
    tools: ComputedRef<StructuredTool[]>
    prompt: ChatLunaChatPrompt
    agentMode: 'react' | 'tool-calling'
    maxIterations?: number
    returnIntermediateSteps?: boolean
    handleParsingErrors?: boolean | string | ((e: Error) => string)
    instructions?: ComputedRef<string | undefined>
}

export type CreateAgentExecutorOptions = CreateAgentRunnerOptions

export function createAgentConfig(options: CreateAgentConfigOptions) {
    if (options.agentMode === 'react') {
        const agent = computed(() => {
            const llm = options.llm.value
            const tools = options.tools.value
            const instructions = options.instructions?.value ?? undefined
            return createReactAgent({
                llm,
                tools,
                prompt: options.prompt,
                instructions
            })
        })

        return computed<AgentConfig>(() => ({
            agent: agent.value,
            tools: options.tools.value,
            agentMode: 'react'
        }))
    }

    const agent = computed(() =>
        createOpenAIAgent({
            llm: options.llm.value,
            tools: options.tools.value,
            prompt: options.prompt
        })
    )

    return computed<AgentConfig>(() => ({
        agent: agent.value,
        tools: options.tools.value,
        agentMode: 'tool-calling'
    }))
}

export function createAgentRunner(
    options: CreateAgentRunnerOptions
): ComputedRef<AgentRunner> {
    const cfg = createAgentConfig(options)

    return computed(() =>
        AgentRunner.fromAgentAndTools({
            agent: cfg.value.agent,
            tools: cfg.value.tools,
            maxIterations: options.maxIterations,
            returnIntermediateSteps: options.returnIntermediateSteps,
            handleParsingErrors: options.handleParsingErrors
        })
    )
}

export const createAgentExecutor = createAgentRunner

export interface CreateToolsRefOptions {
    tools: ComputedRef<ChatLunaTool[]>
    embeddings: ChatLunaBaseEmbeddings
    toolMask?: ToolMask
}

export function createToolsRef(options: CreateToolsRefOptions) {
    const activeTools = shallowRef<ChatLunaTool[]>([])

    const tools = computed(() => {
        return activeTools.value
            .map((tool) => {
                try {
                    return tool.createTool({
                        embeddings: options.embeddings
                    })
                } catch (error) {
                    console.error(`Error creating tool ${tool.id}:`, error)
                }
            })
            .filter(Boolean)
    })

    const getActiveTools = (
        session: Session,
        messages: BaseMessage[],
        toolMask?: ToolMask
    ): [ChatLunaTool[], boolean] => {
        const toolsRef = options.tools.value
        const oldActiveTools = activeTools.value

        const newActiveTools = toolsRef.filter((tool) => {
            if (!applyToolMask(tool.name, toolMask ?? options.toolMask)) {
                return false
            }

            const selected = tool.selector(messages)
            return tool.authorization
                ? tool.authorization(session) && selected
                : selected
        })

        const oldToolIds = new Set(oldActiveTools.map((t) => t.id))

        const hasChanges =
            newActiveTools.length !== oldActiveTools.length ||
            newActiveTools.some((tool) => !oldToolIds.has(tool.id))

        return [newActiveTools, hasChanges]
    }

    const update = (
        session: Session,
        messages: BaseMessage[],
        toolMask?: ToolMask
    ) => {
        const [newActiveTools, recreate] = getActiveTools(
            session,
            messages,
            toolMask
        )
        activeTools.value = newActiveTools

        return recreate
    }

    return {
        update,
        tools
    }
}
