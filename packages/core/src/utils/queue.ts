import { sleep } from 'koishi'
import { ObjectLock } from './lock'

export class RequestIdQueue {
    private _queue: Record<string, string[]> = {}

    private _lock = new ObjectLock()

    // 200 queue
    private _maxQueueSize = 200

    public async add(key: string, requestId: string) {
        const id = await this._lock.lock()
        if (!this._queue[key]) {
            this._queue[key] = []
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

        while (true) {
            const index = this._queue[key].indexOf(requestId)

            if (index === -1) {
                return
            }

            if (index < maxConcurrent || index === 0) {
                return
            }

            await sleep(60)
        }
    }

    public async getQueueLength(key: string) {
        return await this._lock.runLocked(
            async () => this._queue[key]?.length ?? 0
        )
    }
}
