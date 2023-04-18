import { Logger } from "koishi";

const loggers = new Array<Logger>()

let logLevel = -1

export function createLogger(name: string) {
    const result = new Logger(name)

    if (logLevel >= 0) {
        result.level = logLevel
    } else {
        loggers.push(result)
    }

    return result
}

export function setLoggerLevel(level: number) {
    logLevel = level
    loggers.forEach((logger) => {
        logger.level = level
    })
    loggers.length = 0
}