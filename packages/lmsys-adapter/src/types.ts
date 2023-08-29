// https://github.com/chathub-dev/chathub/blob/main/src/app/bots/bing/types.ts

import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config'

export enum FnIndex {
    Send = 41,
    Receive = 42,
    InitSend = 43,
    InitReceive = 25,
    Refresh = 38,
}

export interface ResponseTempParams {
    conversationHash: string,
    fnIndex: number,
    data: unknown[]
    stopTokenFound: boolean
    stopTokens: string[]
    result: string
}

export interface LmsysClientConfig extends ClientConfig {
    formatMessages: boolean
}

type PromiseConstructor = Parameters<ConstructorParameters<PromiseConstructorLike>[0]>


export type PromiseConstructorParameters = {
    [K in "resolve" | "reject"]: K extends "resolve" ? PromiseConstructor[0] : PromiseConstructor[1]
}