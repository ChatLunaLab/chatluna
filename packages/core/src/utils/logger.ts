import { Context, Logger } from 'koishi'
import os from 'os'
import fs from 'fs'

let loggers: Record<string, Logger> = {}

let logLevel = -1

export function createLogger(ctx: Context, name: string = 'chatluna') {
    const result = loggers[name] || ctx.logger(name)

    if (logLevel >= 0) {
        result.level = logLevel
    }

    loggers[name] = result

    return result
}

export function setLoggerLevel(level: number) {
    logLevel = level

    for (const name in loggers) {
        loggers[name].level = level
    }
}

export function clearLogger() {
    loggers = {}
}

export async function trackLogToLocal(
    tag: string,
    output: string,
    logger: Logger
) {
    const currentTime = new Date()
        .toISOString()
        .slice(0, 19)
        .replace('T', '-')
        .replace(/:/g, '-')
    const tempDir = os.tmpdir()
    const logFile = `${tempDir}/chatluna/logs/chatluna-log-${currentTime}.log`

    if (!fs.existsSync(`${tempDir}/chatluna/logs`)) {
        fs.mkdirSync(`${tempDir}/chatluna/logs`, { recursive: true })
    }

    await fs.promises.writeFile(logFile, output)
    logger.info(`[${tag}] A local log file has been created at ${logFile}`)
}
