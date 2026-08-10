import type { EditResult } from './types'

const MAX_DIFF_LINES = 40
const MAX_DIFF_CHARS = 2000
const MAX_DIFF_LINE_CHARS = 900

export function replaceFileContent(
    content: string,
    oldString: string,
    newString: string,
    count?: number
): EditResult {
    if (!content.includes(oldString)) {
        return { success: false, replacements: 0 }
    }

    if (
        count === 1 &&
        content.indexOf(
            oldString,
            content.indexOf(oldString) + oldString.length
        ) !== -1
    ) {
        throw new Error(
            'Found multiple matches for oldString. Provide more surrounding ' +
                'lines in oldString to identify the correct match, or set ' +
                'replaceAll to change every instance.'
        )
    }

    let replacements = 0
    const after = content.replaceAll(oldString, (value) => {
        if (count != null && replacements >= count) return value
        replacements += 1
        return newString
    })

    return {
        success: true,
        before: content,
        after,
        replacements
    }
}

export function formatFileDiff(before: string, after: string) {
    if (before === after) return 'No changes.'

    const oldLines = before.split('\n')
    const newLines = after.split('\n')
    let start = 0
    while (
        start < oldLines.length &&
        start < newLines.length &&
        oldLines[start] === newLines[start]
    ) {
        start += 1
    }

    let oldEnd = oldLines.length
    let newEnd = newLines.length
    while (
        oldEnd > start &&
        newEnd > start &&
        oldLines[oldEnd - 1] === newLines[newEnd - 1]
    ) {
        oldEnd -= 1
        newEnd -= 1
    }

    const removed = oldLines.slice(start, oldEnd)
    const added = newLines.slice(start, newEnd)
    const oldStart = removed.length > 0 ? start + 1 : start
    const newStart = added.length > 0 ? start + 1 : start
    const changes: string[] = []
    for (let idx = 0; idx < Math.max(removed.length, added.length); idx++) {
        if (idx < removed.length) changes.push(`-${removed[idx]}`)
        if (idx < added.length) changes.push(`+${added[idx]}`)
    }

    const context = [
        ...oldLines.slice(Math.max(0, start - 2), start),
        ...oldLines.slice(oldEnd, Math.min(oldLines.length, oldEnd + 2))
    ].map((line) => ` ${line}`)
    const lines = [
        `@@ -${oldStart},${removed.length} +${newStart},${added.length} @@`
    ]
    const marker = '[diff truncated]'
    let chars = lines[0].length
    let truncated = false
    let idx = 0

    for (const value of [...changes, ...context]) {
        if (lines.length >= MAX_DIFF_LINES - 1) {
            truncated = true
            break
        }

        const line = value.slice(0, MAX_DIFF_LINE_CHARS)
        if (line.length < value.length) truncated = true
        if (chars + line.length + 1 > MAX_DIFF_CHARS - marker.length - 1) {
            truncated = true
            break
        }

        lines.push(line)
        chars += line.length + 1
        idx += 1
    }

    if (idx < changes.length + context.length) truncated = true
    if (truncated) lines.push(marker)
    return lines.join('\n')
}
