import { Logger } from "koishi";

let loggers: Record<string, Logger> = {}

let logLevel = -1

export function createLogger(name: string = "chathub") {
    const result = loggers[name] || new Logger(name)

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