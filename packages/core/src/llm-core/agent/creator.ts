import { computed, ComputedRef, shallowRef } from '@vue/reactivity'
import type { ChatLunaChatModel } from '../platform/model'
import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaChatPrompt } from '../chain/prompt'
import { createReactAgent } from './react'
import { AgentExecutor } from './executor'
import { createOpenAIAgent } from './openai'
import { ChatLunaTool } from '../platform/types'
import { BaseMessage } from '@langchain/core/messages'
import { Session } from 'koishi'
import { ChatLunaBaseEmbeddings } from '../platform/model'

export interface CreateAgentExecutorOptions {
    llm: ComputedRef<ChatLunaChatModel>
    tools: ComputedRef<StructuredTool[]>

    prompt: ChatLunaChatPrompt
    agentMode: 'react' | 'tool-calling'
    returnIntermediateSteps?: boolean
    handleParsingErrors?: boolean
    instructions?: ComputedRef<string>
}

export function createAgentExecutor(options: CreateAgentExecutorOptions) {
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

        return computed(() =>
            AgentExecutor.fromAgentAndTools({
                tags: ['react'],
                agent: agent.value,
                tools: options.tools.value,
                memory: undefined,
                verbose: false,
                returnIntermediateSteps:
                    options.returnIntermediateSteps ?? false,
                handleParsingErrors: options.handleParsingErrors ?? true
            })
        )
    }

    const agent = computed(() =>
        createOpenAIAgent({
            llm: options.llm.value,
            tools: options.tools.value,
            prompt: options.prompt
        })
    )

    return computed(() =>
        AgentExecutor.fromAgentAndTools({
            tags: ['tool-calling'],
            agent: agent.value,
            tools: options.tools.value,
            returnIntermediateSteps: options.returnIntermediateSteps ?? false,
            memory: undefined,
            verbose: false
        })
    )
}

export interface CreateToolsRefOptions {
    tools: ComputedRef<ChatLunaTool[]>
    embeddings: ChatLunaBaseEmbeddings
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
        messages: BaseMessage[]
    ): [ChatLunaTool[], boolean] => {
        const toolsRef = options.tools.value
        const oldActiveTools = activeTools.value

        const newActiveTools = toolsRef.filter((tool) => {
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

    const update = (session: Session, messages: BaseMessage[]) => {
        const [newActiveTools, recreate] = getActiveTools(session, messages)
        activeTools.value = newActiveTools

        return recreate
    }

    return {
        update,
        tools
    }
}
