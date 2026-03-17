/**
 * @module utils/frontmatter
 * @description Markdown frontmatter 提取工具。
 */

export function extractFrontmatter(raw: string) {
    const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
    if (!match) {
        return undefined
    }

    return {
        frontmatter: match[1],
        body: match[2].trim()
    }
}
