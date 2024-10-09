import { withResolver } from 'koishi-plugin-chatluna/utils/promise'

export class ObjectLock {
    private _lock: boolean = false

    private _queue: number[] = []
    private _currentId = 0

    async lock() {
        const id = this._currentId++
        this._queue.push(id)

        if (this._lock) {
            const { promise, resolve } = withResolver()

            const timer = setInterval(() => {
                if (this._queue[0] === id && this._lock === false) {
                    clearInterval(timer)
                    resolve(undefined)
                }
            }, 20)

            await promise
        }

        this._lock = true
        return id
    }

    async runLocked<T>(func: () => Promise<T>): Promise<T> {
        const id = await this.lock()
        const result = await func()
        await this.unlock(id)
        return result
    }

    async unlock(id: number) {
        if (!this._lock) {
            throw new Error('unlock without lock')
        }

        const index = this._queue.indexOf(id)

        if (index === -1) {
            throw new Error('unlock without lock')
        }

        this._lock = false
        this._queue.splice(index, 1)
    }

    get isLocked() {
        return this._lock
    }
}
