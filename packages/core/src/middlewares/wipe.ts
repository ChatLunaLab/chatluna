import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { createLogger } from '../utils/logger'
import fs from 'fs/promises'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain
        .middleware('wipe', async (session, context) => {
            const { command } = context

            if (command !== 'wipe') return ChainMiddlewareRunStatus.SKIPPED

            const buffer = [
                '您接下来将要操作的是清除 ChatHub 的全部相关数据！这些数据包括：',
                '\n1. 所有会话数据',
                '2. 其他缓存在数据库的数据',
                '3. 本地向量数据库的相关数据'
            ]

            const expression = generateExpression()

            buffer.push(
                `\n请输入下列算式的结果以确认删除：${expression.expression}。`
            )

            await context.send(buffer.join('\n'))

            const result = await session.prompt(1000 * 30)

            if (!result) {
                context.message = `删除超时，已取消删除`
                return ChainMiddlewareRunStatus.STOP
            }

            if (result !== expression.result.toString()) {
                context.message = `你的输入不正确，已取消删除。`
                return ChainMiddlewareRunStatus.STOP
            }

            // drop database tables

            await ctx.database.drop('chathub_room_member')
            await ctx.database.drop('chathub_conversation')
            await ctx.database.drop('chathub_message')
            await ctx.database.drop('chathub_room')
            await ctx.database.drop('chathub_room_group_member')
            await ctx.database.drop('chathub_user')
            // knowledge

            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await ctx.database.drop('chathub_knowledge' as any)
            } catch (e) {
                logger.warn(`wipe: ${e}`)
            }

            // dorp caches

            await ctx.cache.clear('chathub/chat_limit')
            await ctx.cache.clear('chathub/keys')
            await ctx.cache.clear('chathub/client_config')

            // delete local database and tmps

            try {
                await fs.rm('data/chathub/vector_store', { recursive: true })
            } catch (e) {
                logger.warn(`wipe: ${e}`)
            }

            try {
                await fs.rm('data/chathub/temp', { recursive: true })
            } catch (e) {
                logger.warn(`wipe: ${e}`)
            }

            context.message = `已删除相关数据，即将重启完成更改。`

            ctx.scope.update(config, true)

            return ChainMiddlewareRunStatus.STOP
        })
        .before('black_list')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        wipe: never
    }
}

// 接下来请你给我写这样的代码：随机生成一个三位数的加，乘，减，除 算式并生成字符以及结果。如 { expression: "111+444", result: 555 }
export function generateExpression() {
    const operators = ['+', '-', '*']

    const operator = operators[Math.floor(Math.random() * operators.length)]

    const a = Math.floor(Math.random() * 1000)

    const b = Math.floor(Math.random() * 1000)

    // eslint-disable-next-line no-eval
    const result = eval(`${a}${operator}${b}`)

    return {
        expression: `${a}${operator}${b}`,
        result
    }
}
