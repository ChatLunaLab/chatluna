import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logger } from 'koishi-plugin-chatluna'

export function usageSourceFromStack(stack?: string) {
    if (!stack) {
        logger?.debug('no stack, source=unknown')
        return 'unknown'
    }

    let fallback: string | undefined

    for (const line of stack.split('\n')) {
        logger?.debug(`stack line: ${line}`)

        const match = line.match(
            /\(?((?:[A-Za-z]:[\\/]|\/|file:\/\/\/).+):\d+:\d+\)?$/
        )
        if (!match) {
            logger?.debug('stack line ignored: no file match')
            continue
        }

        const file = match[1].startsWith('file:///')
            ? fileURLToPath(match[1])
            : path.resolve(match[1])
        const slash = file.replaceAll('\\', '/')
        logger?.debug(`matched file: ${file}`)

        let dir = path.dirname(file)
        while (dir !== path.dirname(dir)) {
            const pkg = path.join(dir, 'package.json')
            if (fs.existsSync(pkg)) {
                logger?.debug(`package.json found: ${pkg}`)
                const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name
                logger?.debug(`package name: ${String(name)}`)
                if (typeof name === 'string') {
                    const base = name.split('/').pop()?.replaceAll('_', '-')
                    if (!base?.startsWith('koishi-plugin-')) {
                        logger?.debug('package ignored: not a koishi plugin')
                        break
                    }

                    const source = base.slice('koishi-plugin-'.length)
                    logger?.debug(`package source: ${String(source)}`)
                    if (
                        source &&
                        !name.startsWith('@koishijs/') &&
                        !name.startsWith('@cordisjs/') &&
                        source !== 'chatluna'
                    ) {
                        const result = source.endsWith('-entry-point')
                            ? source.slice(0, -'-entry-point'.length)
                            : source
                        logger?.debug(`source selected: ${result}`)
                        return result
                    }
                    if (source === 'chatluna') {
                        fallback = source
                        logger?.debug('fallback source set: chatluna')
                    } else {
                        logger?.debug('package ignored')
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
            logger?.debug('core frame skipped after package read')
            continue
        }
    }

    logger?.debug(`source fallback result: ${fallback ?? 'unknown'}`)
    return fallback ?? 'unknown'
}
