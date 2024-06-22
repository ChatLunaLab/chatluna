import { ForkScope } from 'koishi'
import { PromiseLikeDisposable } from 'koishi-plugin-chatluna/utils/types'

export function forkScopeToDisposable(scope: ForkScope): PromiseLikeDisposable {
    return () => {
        scope.dispose()
    }
}
