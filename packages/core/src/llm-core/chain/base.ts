import {
    CallbackManager,
    CallbackManagerForChainRun
} from '@langchain/core/callbacks/manager'
import { RunnableConfig } from 'langchain/runnables'
import { BaseChain, ChainInputs } from 'langchain/chains'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import { BaseLLMOutputParser } from '@langchain/core/output_parsers'
import { StructuredTool } from '@langchain/core/tools'
import { ChatEvents } from '../../services/types'
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory'
import { ChatLunaChatModel, ChatLunaModelCallOptions } from '../platform/model'
import { BasePromptTemplate } from '@langchain/core/prompts'
import { Session } from 'koishi'

export const FINISH_NAME = 'finish'

export type ObjectTool = StructuredTool

export type SystemPrompts = BaseMessage[]

export abstract class ChatHubLLMChainWrapper {
    abstract call(arg: ChatHubLLMCallArg): Promise<ChainValues>

    abstract historyMemory: ConversationSummaryMemory | BufferMemory

    abstract get model(): ChatLunaChatModel
}

export interface ChatHubLLMCallArg {
    message: HumanMessage
    events: ChatEvents
    stream: boolean
    conversationId: string
    session: Session
}

export interface ChatHubLLMChainInput extends ChainInputs {
    /** Prompt object to use */
    prompt: BasePromptTemplate
    /** LLM Wrapper to use */
    llm: ChatLunaChatModel
    /** Kwargs to pass to LLM */
    llmKwargs?: this['llm']['CallOptions']
    /** OutputParser to use */
    outputParser?: BaseLLMOutputParser<ChatLunaChatModel>
    /** Key to use for output, defaults to `text` */
    outputKey?: string
}

export class ChatHubLLMChain extends BaseChain implements ChatHubLLMChainInput {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_serializable = false

    prompt: BasePromptTemplate

    llm: ChatLunaChatModel

    outputKey = 'text'

    llmKwargs?: this['llm']['CallOptions']

    get inputKeys() {
        return this.prompt.inputVariables
    }

    get outputKeys() {
        return [this.outputKey]
    }

    constructor(fields: ChatHubLLMChainInput) {
        super(fields)
        this.prompt = fields.prompt
        this.llm = fields.llm
        this.outputKey = fields.outputKey ?? this.outputKey
        this.llmKwargs = fields.llmKwargs
    }

    /** @ignore */
    _selectMemoryInputs(values: ChainValues): ChainValues {
        const valuesForMemory = super._selectMemoryInputs(values)
        for (const key of this.llm.callKeys) {
            if (key in values) {
                delete valuesForMemory[key]
            }
        }
        return valuesForMemory
    }

    /** @ignore */
    async _call(
        values: ChainValues & this['llm']['CallOptions'],
        runManager?: CallbackManagerForChainRun
    ): Promise<ChainValues> {
        const valuesForPrompt = { ...values }
        const valuesForLLM: ChatLunaModelCallOptions = {
            ...this.llmKwargs
        }

        for (const key of this.llm.callKeys) {
            if (key in values) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                valuesForLLM[key as any] = values[key]
                delete valuesForPrompt[key]
            }
        }
        const promptValue = await this.prompt.formatPromptValue(valuesForPrompt)
        const { generations } = await this.llm.generatePrompt(
            [promptValue],
            valuesForLLM as ChatLunaModelCallOptions,
            runManager?.getChild()
        )

        const generation = generations[0][0]

        return {
            [this.outputKey]: generation.text,
            rawGeneration: generation,
            extra: generation?.generationInfo
        }
    }

    /**
     * Invoke the chain with the provided input and returns the output.
     * @param input Input values for the chain run.
     * @param config Optional configuration for the Runnable.
     * @returns Promise that resolves with the output of the chain run.
     */
    async invoke(
        input: ChainInputs & this['llm']['CallOptions'],
        config?: RunnableConfig
    ): Promise<ChainValues> {
        const fullValues = await this._formatValues(input)
        const callbackManager_ = await CallbackManager.configure(
            config?.callbacks,
            this.callbacks,
            config?.tags,
            this.tags,
            config?.metadata,
            this.metadata,
            { verbose: this.verbose }
        )
        const runManager = await callbackManager_?.handleChainStart(
            this.toJSON(),
            fullValues,
            undefined,
            undefined,
            undefined,
            undefined,
            config?.runName
        )
        let outputValues: ChainValues
        try {
            outputValues = await (fullValues.signal
                ? (Promise.race([
                      this._call(
                          fullValues as ChainInputs &
                              this['llm']['CallOptions'],
                          runManager
                      ),
                      // eslint-disable-next-line promise/param-names
                      new Promise((_, reject) => {
                          fullValues.signal?.addEventListener('abort', () => {
                              reject(new Error('AbortError'))
                          })
                      })
                  ]) as Promise<ChainInputs>)
                : this._call(fullValues as ChainInputs, runManager))
        } catch (e) {
            await runManager?.handleChainError(e)
            throw e
        }
        if (!(this.memory == null)) {
            await this.memory.saveContext(
                this._selectMemoryInputs(input),
                outputValues
            )
        }
        await runManager?.handleChainEnd(outputValues)
        // add the runManager's currentRunId to the outputValues

        return outputValues
    }

    _chainType() {
        return 'chathub_chain' as const
    }
}

export async function callChatHubChain(
    chain: ChatHubLLMChain,
    values: ChainValues & ChatHubLLMChain['llm']['CallOptions'],
    events: ChatEvents
): Promise<ChainValues> {
    let usedToken = 0

    const response = await chain.invoke(values, {
        callbacks: [
            {
                handleLLMNewToken(token: string) {
                    events?.['llm-new-token']?.(token)
                },
                handleLLMEnd(output, runId, parentRunId, tags) {
                    usedToken += output.llmOutput?.tokenUsage?.totalTokens
                }
            }
        ]
    })

    await events?.['llm-used-token-count'](usedToken)

    return response
}
