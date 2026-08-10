import {
    ChatLunaError,
    ChatLunaErrorCode,
    createAbortError
} from 'koishi-plugin-chatluna/utils/error'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'
import { withResolver } from 'koishi-plugin-chatluna/utils/promise'
const TIME_MINUTE = 60 * 1000

interface QueueItem {
    requestId: string
    timestamp: number
    // active=true means this waiter has already entered the runnable window.
    active: boolean
    // Queue wait timeout is calculated per item from its position.
    timeout: number
    notifyPromise: {
        promise: Promise<void>
        resolve: () => void
        reject: (error: Error) => void
    }
}

export class RequestIdQueue {
    private _queue: Record<string, QueueItem[]> = {}
    private _queueLocks: Record<string, ObjectLock> = {}
    // Per-key runnable window size used when waking the next batch.
    private _limits: Record<string, number> = {}
    private readonly _maxQueueSize = 50
    private readonly _queueTimeout: number

    constructor(queueTimeout = TIME_MINUTE * 3) {
        this._queueTimeout = queueTimeout
        const timer = setInterval(() => this.cleanup(), queueTimeout)
        timer.unref?.()
    }

    public async add(key: string, requestId: string) {
        // Fast path: check queue size without lock first
        const currentLength = this._queue[key]?.length ?? 0
        if (currentLength >= this._maxQueueSize) {
            throw new ChatLunaError(ChatLunaErrorCode.QUEUE_OVERFLOW)
        }

        // Get or create lock for this specific queue
        if (!this._queueLocks[key]) {
            this._queueLocks[key] = new ObjectLock(this._queueTimeout)
        }

        // Prepare the queue item outside the lock
        const { promise, resolve, reject } = withResolver<void>()
        const queueItem: QueueItem = {
            requestId,
            timestamp: Date.now(),
            active: false,
            timeout: this._queueTimeout,
            notifyPromise: { promise, resolve, reject }
        }

        let isFirst = false

        try {
            await this._queueLocks[key].runLocked(async () => {
                // Initialize queue if needed
                if (!this._queue[key]) {
                    this._queue[key] = []
                }

                // Check if requestId already exists
                const existingIndex = this._queue[key].findIndex(
                    (item) => item.requestId === requestId
                )
                if (existingIndex !== -1) {
                    return // Skip if already exists
                }

                // Double check size under lock
                if (this._queue[key].length >= this._maxQueueSize) {
                    throw new ChatLunaError(ChatLunaErrorCode.QUEUE_OVERFLOW)
                }

                this._queue[key].push(queueItem)
                isFirst = this._queue[key].length === 1
                if (isFirst) {
                    queueItem.active = true
                }
            })

            // Resolve immediately if it's the first item (outside lock)
            if (isFirst) {
                resolve()
            }
        } catch (error) {
            reject(error)
            throw error
        }
    }

    public async remove(key: string, requestId: string) {
        // Skip if queue doesn't exist
        if (!this._queue[key]) return

        // Get or create lock for this specific queue
        if (!this._queueLocks[key]) {
            this._queueLocks[key] = new ObjectLock(this._queueTimeout)
        }

        const lock = this._queueLocks[key]
        const items: QueueItem[] = []
        let removed: QueueItem | undefined

        try {
            await lock.runLocked(async () => {
                if (!this._queue[key]) return

                const index = this._queue[key].findIndex(
                    (item) => item.requestId === requestId
                )

                if (index === -1) return

                // Remove the item
                removed = this._queue[key].splice(index, 1)[0]

                if (this._queue[key].length === 0) {
                    delete this._queue[key]
                    delete this._limits[key]
                    return
                }

                const limit = this._limits[key] ?? 1
                // Free every slot that just became runnable, not only the head.
                for (
                    let idx = 0;
                    idx < this._queue[key].length && idx < limit;
                    idx++
                ) {
                    const item = this._queue[key][idx]
                    if (item.active) {
                        continue
                    }

                    item.active = true
                    items.push(item)
                }
            })

            // Settle removed waiters so abort/cancel paths do not hang.
            if (removed != null && !removed.active) {
                removed.notifyPromise.reject(createAbortError())
            }

            items.forEach((item) => item.notifyPromise.resolve())
        } catch (error) {
            console.error('Error in remove operation:', error)
            // Don't throw here to prevent queue from getting stuck
        }
    }

    public async wait(
        key: string,
        requestId: string,
        maxConcurrent: number,
        timeout: number = this._queueTimeout
    ) {
        if (!this._queue[key]) {
            await this.add(key, requestId)
        }

        if (!this._queueLocks[key]) {
            this._queueLocks[key] = new ObjectLock(this._queueTimeout)
        }

        const lock = this._queueLocks[key]
        const limit = maxConcurrent > 0 ? maxConcurrent : 1
        let item: QueueItem | undefined
        let shouldExecute = false

        await lock.runLocked(async () => {
            if (!this._queue[key]) return

            this._limits[key] = limit

            const index = this._queue[key].findIndex(
                (item) => item.requestId === requestId
            )

            if (index === -1) return

            item = this._queue[key][index]
            // Waiting time grows by batches ahead of this item so long-running
            // requests do not force later waiters to hit the old fixed 3m limit.
            item.timeout =
                index < limit
                    ? timeout
                    : Math.max(
                          this._queueTimeout,
                          Math.ceil(index / limit) * timeout
                      )

            if (index < limit) {
                item.active = true
                shouldExecute = true
            }
        })

        if (shouldExecute || item == null) {
            return
        }

        let timeoutId: NodeJS.Timeout
        const timeoutError = new Error(
            `Queue wait timeout after ${item.timeout}ms`
        )

        try {
            // eslint-disable-next-line promise/param-names
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(timeoutError)
                }, item.timeout)
            })

            await Promise.race([item.notifyPromise.promise, timeoutPromise])
        } catch (error) {
            await this.remove(key, requestId).catch(() => {
                /* ignore */
            })
            throw error
        } finally {
            clearTimeout(timeoutId)
        }
    }

    private async cleanup() {
        const now = Date.now()
        const keys = Object.keys(this._queue)

        // Process each queue separately with its own lock
        for (const key of keys) {
            if (!this._queueLocks[key]) {
                this._queueLocks[key] = new ObjectLock(this._queueTimeout)
            }

            const lock = this._queueLocks[key]
            const expired: QueueItem[] = []
            const items: QueueItem[] = []

            await lock.runLocked(async () => {
                if (!this._queue[key]) return

                for (const item of this._queue[key]) {
                    // Cleanup only expires items that are still waiting. Active
                    // requests are stopped by runtime idle timeout instead.
                    if (!item.active && now - item.timestamp >= item.timeout) {
                        expired.push(item)
                    }
                }

                if (expired.length === 0) {
                    return
                }

                this._queue[key] = this._queue[key].filter(
                    (item) => item.active || now - item.timestamp < item.timeout
                )

                if (this._queue[key].length === 0) {
                    delete this._queue[key]
                    delete this._limits[key]
                    return
                }

                const limit = this._limits[key] ?? 1
                for (
                    let idx = 0;
                    idx < this._queue[key].length && idx < limit;
                    idx++
                ) {
                    const item = this._queue[key][idx]
                    if (item.active) {
                        continue
                    }

                    item.active = true
                    items.push(item)
                }
            })

            expired.forEach((item) => {
                item.notifyPromise.reject(
                    new Error(`Queue wait timeout after ${item.timeout}ms`)
                )
            })

            items.forEach((item) => item.notifyPromise.resolve())
        }
    }

    public async getQueueLength(key: string) {
        // Get or create lock for this specific queue
        if (!this._queueLocks[key]) {
            this._queueLocks[key] = new ObjectLock(this._queueTimeout)
        }

        return await this._queueLocks[key].runLocked(
            async () => this._queue[key]?.length ?? 0
        )
    }

    public async getQueueStatus(key: string) {
        // Get or create lock for this specific queue
        if (!this._queueLocks[key]) {
            this._queueLocks[key] = new ObjectLock(this._queueTimeout)
        }

        return await this._queueLocks[key].runLocked(async () => ({
            length: this._queue[key]?.length ?? 0,
            items:
                this._queue[key]?.map((item) => ({
                    requestId: item.requestId,
                    age: Date.now() - item.timestamp
                })) ?? []
        }))
    }
}
