import { ForkScope } from 'koishi'
import { PromiseLikeDisposable } from './types'
export function forkScopeToDisposable(scope: ForkScope): PromiseLikeDisposable {
    return () => {
        scope.dispose()
    }
}
