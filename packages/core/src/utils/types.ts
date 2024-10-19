export type PromiseLikeDisposable = () => PromiseLike<void> | void

export interface PostHandler {
    prefix: string
    postfix: string
    variables: Record<string, string>
    body?: string
    handler: (data: string) => HandlerResult
}

export interface HandlerResult {
    content: string
    variables: Record<string, string>
}
