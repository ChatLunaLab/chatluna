import { sleep } from 'koishi'

export class ObjectLock {
    private _lock: boolean = false

    private _queue: number[] = []
    private _currentId = 0

    async lock() {
        if (this._lock) {
            const id = this._currentId++
            this._queue.push(id)
            while (this._queue[0] !== id) {
                await sleep(10)
            }
        }

        this._lock = true
    }

    async runLocked<T>(func: () => Promise<T>): Promise<T> { 
        await this.lock()
        const result = await func()
        await this.unlock()
        return result
    }

    async unlock() {
        this._lock = false
        this._queue.shift()
    }

    get isLocked() {
        return this._lock
    }
}

