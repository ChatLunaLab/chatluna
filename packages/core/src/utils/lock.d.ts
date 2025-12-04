export declare class ObjectLock {
    private _lock
    private _queue
    private readonly _timeout
    constructor(timeout?: number)
    lock(): Promise<() => void>
    runLocked<T>(func: () => Promise<T>): Promise<T>
    get isLocked(): boolean
}
