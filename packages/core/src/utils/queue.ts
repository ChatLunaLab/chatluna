export class RequestIdQueue {
    private _queue: Record<string, string[]> = {}


    public add(key: string, requestId: string) {
        if (!this._queue[key]) {
            this._queue[key] = []
        }

        this._queue[key].push(requestId)
    }

    public remove(key: string, requestId: string) {
        if (!this._queue[key]) {
            return
        }

        const index = this._queue[key].indexOf(requestId)

        if (index !== -1) {
            this._queue[key].splice(index, 1)
        }
    }

    public async wait(key: string, requestId: string, maxConcurrent: number) {
        if (!this._queue[key]) {
            this.add(key, requestId)
        }

        while (true) {
            const index = this._queue[key].indexOf(requestId)

            if (index === -1) {
                return
            }

            if (index < maxConcurrent) {
                return
            }

            await new Promise((resolve) => setTimeout(resolve, 100))
        }
    }


    public getQueueLength(key: string) {
        return this._queue[key]?.length ?? 0
    }
}