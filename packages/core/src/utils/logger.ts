import { Context, Logger } from 'koishi'
import os from 'os'
import fs from 'fs'

let loggers: Record<string, Logger> = {},
    logLevel = -1

export function createLogger(ctx: Context, name = 'chatluna') {
    const logger = loggers[name] || ctx.logger(name)
    if (logLevel >= 0) logger.level = logLevel
    return (loggers[name] = logger)
}

export function setLoggerLevel(level: number) {
    logLevel = level
    for (const n in loggers) loggers[n].level = level
}

export function clearLogger() {
    loggers = {}
}

export function trackLogToLocal(
    tag: string,
    output: string,
    logger: Logger,
    level: 'debug' | 'warn' = 'debug'
) {
    setTimeout(() => {
        ;(async () => {
            const dir = `${os.tmpdir()}/chatluna/logs`,
                logFile = `${dir}/chatluna-log-${new Date().toISOString().replace(/[T:.]/g, '-')}-${process.hrtime.bigint()}.log`
            await fs.promises.mkdir(dir, { recursive: true })
            await fs.promises.writeFile(logFile, output)
            logger[level](
                `[${tag}] A local log file has been created at ${logFile}`
            )
            const cutoff = Date.now() - 604800000
            const logs = await Promise.all(
                (await fs.promises.readdir(dir))
                    .filter((f) => f.endsWith('.log'))
                    .map(async (f) => {
                        const p = `${dir}/${f}`,
                            s = await fs.promises.stat(p)
                        return { p, size: s.size, time: s.mtimeMs }
                    })
            )
            logs.sort((a, b) => a.time - b.time)
            let total = logs.reduce((s, l) => s + l.size, 0),
                deleted = 0
            for (const l of logs) {
                if (l.time >= cutoff && total <= 1073741824) break
                try {
                    await fs.promises.unlink(l.p)
                    total -= l.size
                    deleted++
                } catch {}
            }
            if (deleted)
                logger.debug(`[${tag}] Deleted ${deleted} old log file(s).`)
        })().catch(() => undefined)
    }, 0)
}
