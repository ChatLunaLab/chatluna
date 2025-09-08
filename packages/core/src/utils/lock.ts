import { Time } from 'koishi'
import { withResolver } from 'koishi-plugin-chatluna/utils/promise'

export class ObjectLock {
    private _lock: boolean = false
    private _queue: {
        resolve: (unlock: () => void) => void
        reject: (error: Error) => void
    }[] = []

    private readonly _timeout: number

    constructor(timeout = Time.minute * 3) {
        this._timeout = timeout
    }

    async lock(): Promise<() => void> {
        const unlock = () => {
            const next = this._queue.shift()
            if (next) {
                next.resolve(unlock)
            } else {
                this._lock = false
            }
        }

        if (this._lock) {
            // Use call stack to get the error
            let error: Error | null = null

            try {
                throw new Error(`Lock timeout after ${this._timeout}ms`)
            } catch (e) {
                error = e as Error
            }

            const { promise, resolve, reject } = withResolver<() => void>()

            const timeoutId = setTimeout(() => {
                const index = this._queue.findIndex(
                    (q) => q.resolve === resolve
                )
                if (index !== -1) {
                    this._queue.splice(index, 1)
                }
                reject(
                    error ?? new Error(`Lock timeout after ${this._timeout}ms`)
                )
            }, this._timeout)

            this._queue.push({
                resolve: (unlockFn) => {
                    clearTimeout(timeoutId)
                    resolve(unlockFn)
                },
                reject
            })

            return promise
        }

        this._lock = true
        return unlock
    }

    async runLocked<T>(func: () => Promise<T>): Promise<T> {
        const unlock = await this.lock()
        try {
            return await func()
        } finally {
            unlock()
        }
    }

    get isLocked() {
        return this._lock
    }
}
