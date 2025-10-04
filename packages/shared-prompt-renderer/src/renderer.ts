import {
    FunctionProvider,
    RenderOptions,
    RenderResult,
    VariableProvider
} from './types'
import { renderInternal } from './utils'

export class ChatLunaPromptRenderer {
    private _variableProviders: VariableProvider[] = []
    private _functionProviders: Record<string, FunctionProvider> = {}
    private _staticVariables: Record<string, string> = {}

    registerVariableProvider(provider: VariableProvider): () => void {
        this._variableProviders.push(provider)

        return () => {
            const index = this._variableProviders.indexOf(provider)
            if (index !== -1) {
                this._variableProviders.splice(index, 1)
            }
        }
    }

    registerFunctionProvider(
        name: string,
        provider: FunctionProvider
    ): () => void {
        this._functionProviders[name] = provider

        return () => {
            delete this._functionProviders[name]
        }
    }

    setStaticVariable(name: string, value: string): void {
        this._staticVariables[name] = value
    }

    getStaticVariable(name: string): string | undefined {
        return this._staticVariables[name]
    }

    removeStaticVariable(name: string): void {
        delete this._staticVariables[name]
    }

    async render(
        source: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variables: Record<string, any> = {},
        options: RenderOptions = {}
    ): Promise<RenderResult> {
        const { extensions = {}, configurable = {}, maxDepth = 10 } = options

        const mergedExtensions = {
            variableProviders: [
                ...this._variableProviders,
                ...(extensions.variableProviders ?? [])
            ],
            functionProviders: {
                ...this._functionProviders,
                ...(extensions.functionProviders ?? {})
            }
        }

        variables = Object.assign({}, this._staticVariables, variables)

        const detectedVariables: string[] = []

        const result = await renderInternal(
            source,
            variables,
            mergedExtensions,
            configurable,
            detectedVariables,
            0,
            maxDepth
        )

        return {
            text: result,
            variables: Array.from(new Set(detectedVariables))
        }
    }
}
