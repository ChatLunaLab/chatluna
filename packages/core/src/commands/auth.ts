import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chathub.auth', 'chathub 鉴权相关指令', {
        authority: 1
    })

    ctx.command('chathub.balance', 'chathub 余额相关指令')

    ctx.command(
        'chathub.balance.set <balance:number>',
        '设置某个用户的余额，直接覆盖',
        {
            authority: 3
        }
    )
        .option('user', '-u <user:user> 页码')
        .action(async ({ options, session }, balance) => {
            const userId = options.user?.split(':')?.[1] ?? session.userId

            await chain.receiveCommand(session, 'set_balance', {
                authUser: userId,
                balance
            })
        })
}
