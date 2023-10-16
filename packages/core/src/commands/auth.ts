import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chathub.auth', 'chathub 鉴权相关指令', {
        authority: 1
    })

    ctx.command('chathub.auth.list', '列出授权组', {
        authority: 3
    })
        .option('page', '-p <page:number> 页码')
        .option('limit', '-l <limit:number> 每页数量')
        .option('platform', '-t <platform:string> 平台')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_auth_group', {
                authPlatform: options.platform,
                page: options.page ?? 1,
                limit: options.limit ?? 3
            })
        })

    ctx.command('chathub.auth.create', '创建一个授权组')
        .option('name', '-n <name:string> 房间名字')
        .option('preMin', '-pm <min:number> 每分钟限额')
        .option('preDay', '-pd <day:number> 每日限额')
        .option('platform', '-pf <platform:string> 平台')
        .option('supportModels', '-s [...model] 房间密码')
        .option('priority', '-p <priority:number> 优先级')
        .option('cost', '-c <cost:number> token 费用')
        .action(async ({ session, options }) => {
            await chain.receiveCommand(session, 'create_auth_group', {
                auth_group_resolve: {
                    name: options.name ?? undefined,
                    requestPreDay: options.preDay ?? undefined,
                    requestPreMin: options.preMin ?? undefined,
                    platform: options.platform ?? undefined,
                    supportModels: options.supportModels ?? undefined,
                    priority: options.priority ?? undefined
                }
            })
        })

    ctx.command('chathub.balance', 'chathub 余额相关指令')

    ctx.command(
        'chathub.balance.set <balance:number>',
        '设置某个用户的余额，直接覆盖',
        {
            authority: 3
        }
    )

        .option('user', '-u <user:user> 目标用户')
        .action(async ({ options, session }, balance) => {
            const userId = options.user?.split(':')?.[1] ?? session.userId

            await chain.receiveCommand(session, 'set_balance', {
                authUser: userId,
                balance
            })
        })
}
