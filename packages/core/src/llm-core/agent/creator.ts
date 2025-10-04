import { computed, ComputedRef, ref } from '@vue/reactivity'
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
            const instructions = options.instructions.value || undefined
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
            prompt: this.prompt
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
    const activeTools = ref<ChatLunaTool[]>([])

    const tools = computed(() => {
        return activeTools.value.map((tool) =>
            tool.createTool({
                embeddings: options.embeddings
            })
        )
    })

    const getActiveTools = (
        session: Session,
        messages: BaseMessage[]
    ): [ChatLunaTool[], boolean] => {
        const oldActiveTools: ChatLunaTool[] = activeTools.value

        const toolsRef = options.tools.value

        const newActiveTools: [ChatLunaTool, boolean][] = toolsRef.map(
            (tool) => {
                const base = tool.selector(messages)

                if (tool.authorization) {
                    return [tool, tool.authorization(session) && base]
                }

                return [tool, base]
            }
        )

        const differenceTools = newActiveTools.filter((newTool) => {
            const include = oldActiveTools.find(
                (oldTool) => oldTool.id === newTool[0].id
            )

            return !include || (include && newTool[1] === false)
        })

        if (differenceTools.length < 1) {
            return [toolsRef, oldActiveTools.length === toolsRef.length]
        }

        for (const differenceTool of differenceTools) {
            const index = oldActiveTools.findIndex(
                (tool) => tool.name === differenceTool[0].name
            )
            if (index > -1) {
                oldActiveTools.splice(index, 1)
            }

            if (differenceTool[1] === true) {
                oldActiveTools.push(differenceTool[0])
            }
        }

        return [oldActiveTools, true]
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
