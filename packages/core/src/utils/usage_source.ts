import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export function usageSourceFromStack(stack?: string) {
    if (!stack) return 'unknown'

    let fallback: string | undefined

    for (const line of stack.split('\n')) {
        const match =
            line.match(
                /^\s*at\s+(?:[^()]+\()?((?:[A-Za-z]:[\\/]|\/|file:\/\/\/).+):\d+:\d+\)?$/
            ) ?? line.match(/^((?:[A-Za-z]:[\\/]|\/|file:\/\/\/).+):\d+:\d+$/)
        if (!match) continue

        const file = match[1].startsWith('file:///')
            ? fileURLToPath(match[1])
            : path.resolve(match[1])
        const slash = file.replaceAll('\\', '/')

        let dir = path.dirname(file)
        while (dir !== path.dirname(dir)) {
            const pkg = path.join(dir, 'package.json')
            if (fs.existsSync(pkg)) {
                const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name
                if (typeof name === 'string') {
                    const base = name.split('/').pop()?.replaceAll('_', '-')
                    if (!base?.startsWith('koishi-plugin-')) break

                    const source = base.slice('koishi-plugin-'.length)
                    if (
                        source &&
                        !name.startsWith('@koishijs/') &&
                        !name.startsWith('@cordisjs/') &&
                        source !== 'chatluna'
                    ) {
                        return source.endsWith('-entry-point')
                            ? source.slice(0, -'-entry-point'.length)
                            : source
                    }
                    if (source === 'chatluna') {
                        fallback = source
                    }
                }
                break
            }
            dir = path.dirname(dir)
        }

        if (
            slash.includes('/packages/core/src/') ||
            slash.includes('/packages/core/lib/') ||
            slash.includes('/node_modules/koishi-plugin-chatluna/')
        ) {
            continue
        }
    }

    return fallback ?? 'unknown'
}
