/**
 * @module computer/backends/types
 * @description Computer backend 共享工具。
 */

import type { ExecuteResult } from '../types'

/** Shell 单引号转义。 */
export function quoteShell(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`
}

/** 截断输出文本。 */
export function truncateOutput(text: string, limit: number): string {
    if (text.length <= limit) {
        return text
    }

    return `${text.slice(0, limit)}\n...[output truncated]`
}

/** 标准化 execute 输出为单个文本块。 */
export function formatExecuteResult(result: ExecuteResult): string {
    const parts: string[] = []

    if (result.stdout) {
        parts.push(result.stdout)
    }

    if (result.stderr) {
        parts.push(`[stderr]\n${result.stderr}`)
    }

    return parts.join('\n') || '(no output)'
}
