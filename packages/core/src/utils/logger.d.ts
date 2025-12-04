import { Context, Logger } from 'koishi'
export declare function createLogger(ctx: Context, name?: string): Logger
export declare function setLoggerLevel(level: number): void
export declare function clearLogger(): void
export declare function trackLogToLocal(
    tag: string,
    output: string,
    logger: Logger
): Promise<void>
