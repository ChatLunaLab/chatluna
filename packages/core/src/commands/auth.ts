import { Context } from 'koishi'
import { ChatChain } from '../chains/chain'
import { Config } from '../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna.auth', 'chatluna 鉴权相关指令', {
        authority: 1
    })

    ctx.command('chatluna.auth.list', '列出授权组', {
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

    ctx.command('chatluna.auth.add <name:string>', '把用户加入到某个配额组里')
        .option('user', '-u <user:user> 目标用户')

        .action(async ({ session, options }, name) => {
            const userId = options.user?.split(':')?.[1] ?? session.userId

            await chain.receiveCommand(session, 'add_user_to_auth_group', {
                auth_group_resolve: {
                    name
                },
                authUser: userId
            })
        })

    ctx.command('chatluna.auth.kick <name:string>', '把用户踢出某个配额组')
        .option('user', '-u <user:user> 目标用户')

        .action(async ({ session, options }, name) => {
            const userId = options.user?.split(':')?.[1] ?? session.userId

            await chain.receiveCommand(session, 'kick_user_form_auth_group', {
                auth_group_resolve: {
                    name
                },
                authUser: userId
            })
        })

    ctx.command('chatluna.auth.create', '创建一个授权组')
        .option('name', '-n <name:string> 房间名字')
        .option('preMin', '-pm <min:number> 每分钟限额')
        .option('preDay', '-pd <day:number> 每日限额')
        .option('platform', '-pf <platform:string> 平台')
        .option('supportModels', '-s [...model] 支持的模型')
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

    ctx.command('chatluna.balance', 'chatluna 余额相关指令')

    ctx.command(
        'chatluna.balance.clear <user:user>',
        '设置某个用户的余额，直接覆盖',
        {
            authority: 3
        }
    ).action(async ({ options, session }, user) => {
        const userId = user?.split(':')?.[1] ?? user

        await chain.receiveCommand(session, 'clear_balance', {
            authUser: userId
        })
    })

    ctx.command(
        'chatluna.balance.set <balance:number>',
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

    ctx.command(
        'chatluna.balance.query [user:user]',
        '查询某个用户的余额'
    ).action(async ({ options, session }, user) => {
        const userId = user?.split(':')?.[1] ?? session.userId

        await chain.receiveCommand(session, 'query_balance', {
            authUser: userId
        })
    })
}
