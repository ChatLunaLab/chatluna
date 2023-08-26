import { BasePromptTemplate } from 'langchain';
import { CallbackManager, CallbackManagerForChainRun, Callbacks } from 'langchain/callbacks';
import { ChainInputs, BaseChain, LLMChainInput, SerializedLLMChain } from 'langchain/chains';
import { BaseLanguageModel } from 'langchain/dist/base_language';
import { AIMessage, BaseMessage, BaseChatMessageHistory, BasePromptValue, ChainValues, ChatResult, Generation, HumanMessage } from 'langchain/schema';
import { BaseOutputParser } from 'langchain/schema/output_parser';
import { StructuredTool } from "langchain/tools";
import { ChatEvents } from '../../services/types';
import { BufferMemory, ConversationSummaryMemory } from 'langchain/memory';
import { ChatHubChatModel } from '../platform/model';

export const FINISH_NAME = "finish";

export type ObjectTool = StructuredTool;

export type SystemPrompts = BaseMessage[]


export abstract class ChatHubLLMChainWrapper {
    abstract call(message: HumanMessage, events: ChatEvents): Promise<ChainValues>


    abstract historyMemory: ConversationSummaryMemory | BufferMemory

    // TODO: refactor to ChatHubChatModel
    abstract get model(): ChatHubChatModel
}


export interface ChatHubLLMChainInput
    extends ChainInputs {
    /** Prompt object to use */
    prompt: BasePromptTemplate;
    /** LLM Wrapper to use */
    llm: ChatHubChatModel;

    /** Key to use for output, defaults to `text` */
    outputKey?: string;
}



export class ChatHubLLMChain
    extends BaseChain
    implements ChatHubLLMChainInput {

    prompt: BasePromptTemplate;

    llm: ChatHubChatModel;

    outputKey = "text";

    get inputKeys() {
        return this.prompt.inputVariables;
    }

    get outputKeys() {
        return [this.outputKey];
    }

    constructor(fields: ChatHubLLMChainInput) {
        super(fields);
        this.prompt = fields.prompt;
        this.llm = fields.llm;
        this.outputKey = fields.outputKey ?? this.outputKey;
    }


    /**
     * Run the core logic of this chain and add to output if desired.
     *
     * Wraps _call and handles memory.
     */
    call(
        values: ChainValues & this["llm"]["CallOptions"],
        callbacks?: Callbacks | undefined
    ): Promise<ChainValues> {
        return super.call(values, callbacks);
    }

    /** @ignore */
    async _call(
        values: ChainValues & this["llm"]["CallOptions"],
        runManager?: CallbackManagerForChainRun
    ): Promise<ChainValues> {
        const valuesForPrompt = { ...values };
        const valuesForLLM: this["llm"]["CallOptions"] = {};
        for (const key of this.llm.callKeys) {
            if (key in values) {
                valuesForLLM[key as keyof this["llm"]["CallOptions"]] = values[key] as this["llm"]["CallOptions"][keyof this["llm"]["CallOptions"]]
                delete valuesForPrompt[key];
            }
        }

        const promptValue = await this.prompt.formatPromptValue(valuesForPrompt);
        const { generations } = (await this.llm.generatePrompt(
            [promptValue],
            valuesForLLM,
            runManager?.getChild()
        ))

        const generation = generations[0][0]

        return {
            [this.outputKey]: generation.text,
            rawGenaration: generation,
            extra: generation?.generationInfo
        };
    }

    /**
     * Format prompt with values and pass to LLM
     *
     * @param values - keys to pass to prompt template
     * @param callbackManager - CallbackManager to use
     * @returns Completion from LLM.
     *
     * @example
     * ```ts
     * llm.predict({ adjective: "funny" })
     * ```
     */
    async predict(
        values: ChainValues & this["llm"]["CallOptions"],
        callbackManager?: CallbackManager
    ): Promise<string> {
        const output = await this.call(values, callbackManager);
        return output[this.outputKey];
    }

    _chainType() {
        return "chathub_chain" as const;
    }

    static async deserialize(data: SerializedLLMChain): Promise<BaseChain> {
        throw new Error("Not implemented");
    }

    serialize(): SerializedLLMChain {
        throw new Error("Not implemented");
    }
}

declare module 'langchain/chains' {
    interface ChainValues {
        extra?: Record<string, any>;
    }
}
