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
        try {
            const dir = `${os.tmpdir()}/chatluna/logs`,
                logFile = `${dir}/chatluna-log-${new Date().toISOString().replace(/[T:.]/g, '-')}-${process.hrtime.bigint()}.log`
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(logFile, output)
            logger[level](
                `[${tag}] A local log file has been created at ${logFile}`
            )
            const cutoff = Date.now() - 604800000
            const logs = fs
                .readdirSync(dir)
                .filter((f) => f.endsWith('.log'))
                .map((f) => {
                    const p = `${dir}/${f}`,
                        s = fs.statSync(p)
                    return { p, size: s.size, time: s.mtimeMs }
                })
                .sort((a, b) => a.time - b.time)
            let total = logs.reduce((s, l) => s + l.size, 0),
                deleted = 0
            for (const l of logs) {
                if (l.time >= cutoff && total <= 1073741824) break
                try {
                    fs.unlinkSync(l.p)
                    total -= l.size
                    deleted++
                } catch {}
            }
            if (deleted)
                logger.debug(`[${tag}] Deleted ${deleted} old log file(s).`)
        } catch {}
    }, 0)
}
