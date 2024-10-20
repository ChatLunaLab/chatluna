import { Session } from 'koishi'

export type PromiseLikeDisposable = () => PromiseLike<void> | void

export interface PostHandler {
    prefix: string
    postfix: string
    censor?: boolean
    variables: Record<string, string>
    handler: (session: Session, data: string) => Promise<HandlerResult>
}

export interface HandlerResult {
    displayContent: string
    content: string
    variables: Record<string, string>
}
