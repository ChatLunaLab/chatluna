// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VariableProvider = () => Record<string, unknown>

export type FunctionProvider = (
    args: string[],
    variables: Record<string, unknown>,
    configurable: RenderConfigurable
) => Promise<string> | string

export interface RenderOptions {
    extensions?: {
        variableProviders?: VariableProvider[]
        functionProviders?: Record<string, FunctionProvider>
    }
    configurable?: RenderConfigurable
    maxDepth?: number // Default: 10
}

export interface RenderConfigurable {
    [key: string]: unknown
}

export interface RenderResult {
    text: string
    variables: string[]
}
