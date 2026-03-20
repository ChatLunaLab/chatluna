/**
 * @module utils/shell
 * @description Shell 字符串与错误消息公共工具。
 */

/** 单引号转义，用于 sh/bash 命令构建。 */
export function quoteShell(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`
}

export function quoteShellPath(value: string): string {
    if (value === '~') {
        return '"$HOME"'
    }

    if (value.startsWith('~/')) {
        return `"$HOME/${value
            .slice(2)
            .replaceAll('\\', '/')
            .replaceAll('"', '\\"')
            .replaceAll('`', '\\`')
            .replaceAll('$', '\\$')}"`
    }

    return quoteShell(value)
}

/** 安全提取 error.message。 */
export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
