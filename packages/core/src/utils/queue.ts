import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'

export class RequestIdQueue {
    private _queue: Record<string, string[]> = {}

    private _lock = new ObjectLock()

    // 200 queue
    private _maxQueueSize = 50

    public async add(key: string, requestId: string) {
        const id = await this._lock.lock()
        if (!this._queue[key]) {
            this._queue[key] = []
        }

        if (this._queue[key].length >= this._maxQueueSize) {
            throw new ChatLunaError(ChatLunaErrorCode.QUEUE_OVERFLOW)
        }

        this._queue[key].push(requestId)
        await this._lock.unlock(id)
    }

    public async remove(key: string, requestId: string) {
        const id = await this._lock.lock()
        if (!this._queue[key]) {
            return
        }

        const index = this._queue[key].indexOf(requestId)

        if (index !== -1) {
            this._queue[key].splice(index, 1)
        }
        await this._lock.unlock(id)
    }

    public async wait(key: string, requestId: string, maxConcurrent: number) {
        if (!this._queue[key]) {
            await this._lock.runLocked(async () => {})

            await this.add(key, requestId)
        }

        await new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                const index = this._queue[key].indexOf(requestId)

                if (index === -1) {
                    clearInterval(timer)
                    resolve(undefined)
                }

                if (index < maxConcurrent || index === 0) {
                    clearInterval(timer)
                    resolve(undefined)
                }
            }, 20)
        })
    }

    public async getQueueLength(key: string) {
        return await this._lock.runLocked(
            async () => this._queue[key]?.length ?? 0
        )
    }
}
