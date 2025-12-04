import { ForkScope } from 'koishi'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'
export declare function forkScopeToDisposable(
    scope: ForkScope
): PromiseLikeDisposable
