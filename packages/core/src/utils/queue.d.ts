export declare class RequestIdQueue {
    private _queue
    private _queueLocks
    private readonly _maxQueueSize
    private readonly _queueTimeout
    constructor(queueTimeout?: number)
    add(key: string, requestId: string): Promise<void>
    remove(key: string, requestId: string): Promise<void>
    wait(key: string, requestId: string, maxConcurrent: number): Promise<void>
    private cleanup
    getQueueLength(key: string): Promise<number>
    getQueueStatus(key: string): Promise<{
        length: number
        items: {
            requestId: string
            age: number
        }[]
    }>
}
