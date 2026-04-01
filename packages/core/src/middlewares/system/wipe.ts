import { Context, Logger, Session } from 'koishi'
import { Config } from '../../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import fs from 'fs/promises'
import {
    createLegacyTableRetention,
    dropTableIfExists,
    LEGACY_MIGRATION_TABLES,
    LEGACY_RETENTION_META_KEY,
    LEGACY_RUNTIME_TABLES,
    purgeLegacyTables,
    readMetaValue,
    writeMetaValue
} from '../../migration/validators'

let logger: Logger

export function apply(ctx: Context, _config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    chain.middleware('purge_legacy', async (session, context) => {
        if (context.command !== 'purge_legacy') {
            return ChainMiddlewareRunStatus.SKIPPED
        }

        const result = await readMetaValue<{
            passed?: boolean
        }>(ctx, 'validation_result')

        if (result?.passed !== true) {
            context.message =
                'Legacy purge is blocked until migration validation passes.'
            return ChainMiddlewareRunStatus.STOP
        }

        const status = await confirmWipe(session, '.confirm_wipe')
        if (status !== 'ok') {
            context.message =
                status === 'timeout'
                    ? session.text('.timeout')
                    : session.text('.incorrect_input')
            return ChainMiddlewareRunStatus.STOP
        }

        await purgeLegacyTables(ctx)
        await writeMetaValue(ctx, 'legacy_purged_at', new Date().toISOString())
        await writeMetaValue(
            ctx,
            LEGACY_RETENTION_META_KEY,
            createLegacyTableRetention('purged')
        )
        context.message = 'Legacy ChatHub tables were purged.'
        return ChainMiddlewareRunStatus.STOP
    })

    chain.middleware('wipe', async (session, context) => {
        const { command } = context

        if (command !== 'wipe') return ChainMiddlewareRunStatus.SKIPPED

        const status = await confirmWipe(session, '.confirm_wipe', context.send)
        if (status !== 'ok') {
            context.message = session.text(
                status === 'timeout' ? '.timeout' : '.incorrect_input'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        // drop database tables

        for (const table of [
            'chatluna_conversation',
            'chatluna_message',
            'chatluna_binding',
            'chatluna_constraint',
            'chatluna_archive',
            'chatluna_acl',
            'chatluna_meta'
        ]) {
            await dropTableIfExists(ctx, table)
        }

        for (const table of LEGACY_MIGRATION_TABLES) {
            await dropTableIfExists(ctx, table)
        }

        for (const table of LEGACY_RUNTIME_TABLES) {
            await dropTableIfExists(ctx, table)
        }

        await dropTableIfExists(ctx, 'chatluna_docstore')
        // knowledge

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await dropTableIfExists(ctx, 'chathub_knowledge' as any)

        // drop caches

        await ctx.chatluna.cache.clear('chatluna/chat_limit')
        await ctx.chatluna.cache.clear('chatluna/keys')

        // delete local database and temps

        try {
            await fs.rm('data/chathub/vector_store', { recursive: true })
        } catch (e) {
            logger.warn(`wipe: ${e}`)
        }

        try {
            await fs.rm('data/chatluna/temp', { recursive: true })
        } catch (e) {
            logger.warn(`wipe: ${e}`)
        }

        context.message = session.text('.success')

        const appContext = ctx.scope.parent
        appContext.scope.update(appContext.config, true)

        return ChainMiddlewareRunStatus.STOP
    })
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        purge_legacy: never
        wipe: never
    }
}

export function generateExpression() {
    const operators = ['+', '-', '*']

    const operator = operators[Math.floor(Math.random() * operators.length)]

    const a = Math.floor(Math.random() * 1000)

    const b = Math.floor(Math.random() * 1000)

    let result: number
    switch (operator) {
        case '+':
            result = a + b
            break
        case '-':
            result = a - b
            break
        case '*':
            result = a * b
            break
        default:
            result = 0
    }

    return {
        expression: `${a}${operator}${b}`,
        result
    }
}

async function confirmWipe(
    session: Session,
    key: string,
    send?: (message: string) => Promise<unknown>
) {
    const expression = generateExpression()

    if (send) {
        await send(session.text(key, [expression.expression]))
    } else {
        await session.send(session.text(key, [expression.expression]))
    }

    const result = await session.prompt(1000 * 30)

    if (!result) {
        return 'timeout' as const
    }

    return result === expression.result.toString()
        ? ('ok' as const)
        : ('incorrect' as const)
}
