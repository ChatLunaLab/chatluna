import { Context, Logger, sleep } from 'koishi'
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
    logger: Logger,
    level: 'debug' | 'warn' = 'debug'
) {
    const currentTime = new Date()
        .toISOString()
        .slice(0, 19)
        .replace('T', '-')
        .replace(/:/g, '-')
    const tempDir = os.tmpdir()
    const logDir = `${tempDir}/chatluna/logs`
    const logFile = `${logDir}/chatluna-log-${currentTime}.log`

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
    }

    const writeAndCleanup = async () => {
        await fs.promises.writeFile(logFile, output)

        logger[level](
            '[%s] A local log file has been created at %s',
            tag,
            logFile
        )

        // Clean up old log files (older than 7 days)
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const files = await fs.promises.readdir(logDir)
        let deletedCount = 0

        for (const file of files) {
            if (!file.startsWith('chatluna-log-') || !file.endsWith('.log')) {
                continue
            }

            const filePath = `${logDir}/${file}`
            let stats: fs.Stats
            try {
                stats = await fs.promises.stat(filePath)
            } catch {
                continue
            }

            if (stats.mtimeMs < sevenDaysAgo) {
                try {
                    await fs.promises.unlink(filePath)
                    deletedCount += 1
                } catch {
                    // ignore failed deletions
                }
                await sleep(0)
            }
        }

        if (deletedCount > 0) {
            logger.debug(`[${tag}] Deleted ${deletedCount} old log file(s).`)
        }
    }

    setTimeout(() => {
        writeAndCleanup().catch(() => undefined)
    }, 0)
}
