import { BaseMessage } from '@langchain/core/messages'
import { PresetTemplate } from 'koishi-plugin-chatluna/llm-core/prompt'
import {
    FunctionProvider,
    RenderOptions,
    RenderResult,
    VariableProvider
} from '@chatluna/shared-prompt-renderer'
export declare class ChatLunaPromptRenderService {
    private _renderer
    constructor()
    private _initBuiltinFunctions
    registerFunctionProvider(
        name: string,
        handler: FunctionProvider
    ): () => void

    registerVariableProvider(provider: VariableProvider): () => void
    setVariable(name: string, value: string): void
    getVariable(name: string): string | undefined
    removeVariable(name: string): void
    renderTemplate(
        source: string,
        variables?: Record<string, any>,
        options?: RenderOptions
    ): Promise<RenderResult>

    renderMessages(
        messages: BaseMessage[],
        variables?: Record<string, any>,
        options?: RenderOptions
    ): Promise<BaseMessage[]>

    renderPresetTemplate(
        presetTemplate: PresetTemplate,
        variables?: Record<string, any>,
        options?: RenderOptions
    ): Promise<
        Omit<RenderResult, 'text'> & {
            messages: BaseMessage[]
        }
    >
}
