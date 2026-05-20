import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Context, Session } from 'koishi'
import type { UsageContext } from './usage'

export function usageSourceFromPackageName(name: string) {
    const base = name.split('/').pop()?.replaceAll('_', '-')
    if (!base) return 'unknown'
    const source = base.startsWith('koishi-plugin-')
        ? base.slice('koishi-plugin-'.length)
        : base
    return source.endsWith('-entry-point')
        ? source.slice(0, -'-entry-point'.length)
        : source
}

const STACK_SOURCE_CACHE_LIMIT = 1024
const stackSourceCache = new Map<string, string>()

type UsageSourceScope = {
    runtime?: { name?: string }
    parent?: { scope?: UsageSourceScope }
}

export function usageSourceFromStack(stack?: string) {
    if (!stack) return 'unknown'

    for (const line of stack.split('\n')) {
        const match = line.match(
            /\(?((?:[A-Za-z]:[\\/]|\/|file:\/\/\/).+):\d+:\d+\)?$/
        )
        if (!match) continue

        const file = match[1].startsWith('file:///')
            ? fileURLToPath(match[1])
            : path.resolve(match[1])
        const slashFile = file.replaceAll('\\', '/')
        if (
            slashFile.includes('/packages/core/src/') ||
            slashFile.includes('/packages/core/lib/') ||
            slashFile.includes('/node_modules/koishi-plugin-chatluna/')
        ) {
            continue
        }

        const cached = stackSourceCache.get(file)
        if (cached !== undefined) {
            if (cached === 'unknown') continue
            return cached
        }

        let dir = path.dirname(file)
        while (dir !== path.dirname(dir)) {
            const pkg = path.join(dir, 'package.json')
            if (fs.existsSync(pkg)) {
                try {
                    const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name
                    if (typeof name === 'string') {
                        const source = usageSourceFromPackageName(name)
                        const isFramework =
                            name === 'koishi' ||
                            name.startsWith('@koishijs/') ||
                            name.startsWith('@cordisjs/') ||
                            source === 'chatluna'

                        if (!isFramework) {
                            if (
                                stackSourceCache.size >=
                                STACK_SOURCE_CACHE_LIMIT
                            ) {
                                stackSourceCache.clear()
                            }
                            stackSourceCache.set(file, source)
                            return source
                        }
                    }
                } catch {}
                break
            }
            dir = path.dirname(dir)
        }

        if (stackSourceCache.size >= STACK_SOURCE_CACHE_LIMIT) {
            stackSourceCache.clear()
        }
        stackSourceCache.set(file, 'unknown')
    }

    return 'unknown'
}

export function usageSourceFromContext(ctx?: Context) {
    let scope = ctx?.scope as UsageSourceScope | undefined

    while (scope != null) {
        const name = scope.runtime?.name
        if (typeof name === 'string') {
            const source = usageSourceFromPackageName(name)
            const isFramework =
                name === 'root' ||
                name === 'koishi' ||
                name.startsWith('@koishijs/') ||
                name.startsWith('@cordisjs/') ||
                source === 'chatluna'

            if (!isFramework) return source
        }

        scope = scope.parent?.scope
    }

    return 'unknown'
}

export function withUsageContextOption(opts: unknown, source: string) {
    const value =
        typeof opts === 'object' && opts != null
            ? (opts as Record<string, unknown>)
            : {}
    const cfg = value.configurable as
        | (Partial<UsageContext> & {
              session?: Session
          })
        | undefined
    const usage = value.chatlunaUsageContext as
        | Partial<UsageContext>
        | undefined

    return {
        ...value,
        chatlunaUsageContext: {
            source: usage?.source ?? cfg?.source ?? source,
            conversationId: usage?.conversationId ?? cfg?.conversationId,
            requestId: usage?.requestId ?? cfg?.requestId,
            userId: usage?.userId ?? cfg?.userId ?? cfg?.session?.userId,
            guildId: usage?.guildId ?? cfg?.guildId ?? cfg?.session?.guildId
        }
    }
}
