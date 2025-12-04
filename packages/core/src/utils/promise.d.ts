export interface Resolver<R = void, E = unknown> {
    promise: Promise<R>
    resolve: (res: R) => void
    reject: (err: E) => void
}
export declare function withResolver<R = void, E = unknown>(): Resolver<R, E>
export declare function runAsync(func: () => Promise<void>): void
export declare function runAsyncTimeout<T>(
    func: Promise<T>,
    timeout: number,
    defaultValue?: T | null
): Promise<T>
