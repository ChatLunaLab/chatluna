import { Logger } from "koishi";

const loggers = new Array<Logger>()

const logger = new Logger("chathub")
let logLevel = -1

export function createLogger() {
    const result = logger

    if (logLevel >= 0) {
        result.level = logLevel
    }

    return result
}

export function setLoggerLevel(level: number) {
    logLevel = level
    logger.level = level
}