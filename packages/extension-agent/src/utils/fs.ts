/**
 * @module utils/fs
 * @description 安全路径解析与递归文件收集工具。
 */

import { readdir } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { isPathInside } from './path'

export interface CollectFilesOptions {
    limit?: number
    extensionFilter?: string
    excludeNames?: string[]
    relative?: boolean
}

/** 解析路径并确保不越界 root。 */
export function resolveSafe(root: string, file: string): string | undefined {
    const target = resolve(root, file)
    return isPathInside(target, root) ? target : undefined
}

/** 递归收集目录下所有文件。 */
export async function collectFilesRecursive(
    root: string,
    options: CollectFilesOptions = {}
): Promise<string[]> {
    const result: string[] = []
    const queue = [root]
    const limit = options.limit ?? Infinity

    while (queue.length > 0 && result.length < limit) {
        const current = queue.shift()
        if (!current) {
            continue
        }

        const entries = await readdir(current, { withFileTypes: true }).catch(
            () => []
        )

        for (const entry of entries) {
            if (
                entry.name === '.git' ||
                entry.name === 'node_modules' ||
                options.excludeNames?.includes(entry.name)
            ) {
                continue
            }

            const file = join(current, entry.name)

            if (entry.isDirectory()) {
                queue.push(file)
                continue
            }

            if (!entry.isFile()) {
                continue
            }

            if (
                options.extensionFilter &&
                !entry.name.toLowerCase().endsWith(options.extensionFilter)
            ) {
                continue
            }

            result.push(
                options.relative
                    ? relative(root, file).replaceAll('\\', '/')
                    : file
            )

            if (result.length >= limit) {
                break
            }
        }
    }

    return result.sort((a, b) => a.localeCompare(b))
}
