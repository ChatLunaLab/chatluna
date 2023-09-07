import { sleep } from 'koishi'
import { ObjectLock } from './lock'
import { createLogger } from './logger'

const logger = createLogger()

export class RequestIdQueue {
    private _queue: Record<string, string[]> = {}

    private _lock = new ObjectLock()

    public async add(key: string, requestId: string) {
        await this._lock.lock()
        if (!this._queue[key]) {
            this._queue[key] = []
        }

        this._queue[key].push(requestId)
        await this._lock.unlock()
    }

    public async remove(key: string, requestId: string) {
        await this._lock.lock()
        if (!this._queue[key]) {
            return
        }

        const index = this._queue[key].indexOf(requestId)

        if (index !== -1) {
            this._queue[key].splice(index, 1)
        }
        await this._lock.unlock()
    }

    public async wait(key: string, requestId: string, maxConcurrent: number) {

        if (!this._queue[key]) {
            await this._lock.lock()
            await this._lock.unlock()
            await this.add(key, requestId)
        }

        while (true) {
            const index = this._queue[key].indexOf(requestId)

            if (index === -1) {
                return
            }

            if (index < maxConcurrent || index == 0) {
                return
            }

            await sleep(60)
        }
    }


    public async getQueueLength(key: string) {
        await this._lock.lock()
        const length = this._queue[key]?.length ?? 0
        await this._lock.unlock()
        return length
    }
}

export class CacheMap<T> {
    private _cache: Record<string, T> = {}
    private _lock = new ObjectLock()
    private _timeout: Record<string, NodeJS.Timeout> = {}

    constructor(private timeout: number = 60 * 5) {
    }

    public async get(key: string) {
        await this._lock.lock()
        const value = this._cache[key]
        await this._lock.unlock()
        return value
    }

    public async set(key: string, value: T, equalFunction:
        (value1: T, value2: T) => boolean = (value1, value2) => value1 === value2) {

        await this._lock.lock()

        if (this._cache[key]) {
            if (equalFunction(this._cache[key], value)) {
                await this._lock.unlock()
                return false
            }
        }

        if (this._timeout[key]) {
            clearTimeout(this._timeout[key])
        }

        this._cache[key] = value
        await this._lock.unlock()

        this._timeout[key] = setTimeout(async () => {
            await this._lock.lock()
            delete this._cache[key]
            delete this._timeout[key]
            await this._lock.unlock()
        }, this.timeout * 1000)

        return true
    }

    public async delete(key: string) {
        await this._lock.lock()
        delete this._cache[key]
        await this._lock.unlock()
    }

    public async clear() {
        await this._lock.lock()
        this._cache = {}
        await this._lock.unlock()
    }
}