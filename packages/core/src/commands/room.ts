import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna.room', 'chatluna 房间相关指令', {
        authority: 1
    })

    ctx.command('chatluna.room.create', '创建一个新房间')
        .option('name', '-n <name:string> 房间名字')
        .option('preset', '-p <preset:string> 房间预设')
        .option('model', '-m <model:string> 房间模型')
        .option('chatMode', '-c <chatMode:string> 房间聊天模式')
        .option('password', '-w <password:string> 房间密码')
        .option('visibility', '-v <visibility:string> 房间可见性')
        .action(async ({ session, options }) => {
            await chain.receiveCommand(session, 'create_room', {
                room_resolve: {
                    name: options.name ?? undefined,
                    preset: options.preset ?? undefined,
                    model: options.model ?? undefined,
                    chatMode: options.chatMode ?? undefined,
                    password: options.password ?? undefined,
                    visibility: options.visibility ?? undefined
                }
            })
        })

    ctx.command('chatluna.room.delete [room:text]', '删除一个房间').action(
        async ({ session }, room) => {
            await chain.receiveCommand(session, 'delete_room', {
                room_resolve: {
                    name: room
                }
            })
        }
    )

    ctx.command(
        'chatluna.room.auto-update <status:string>',
        '设置模版克隆房间的自动更新属性'
    )
        .option('room', '-r <room:string> 指定房间')
        .action(async ({ session, options }, status) => {
            // status only 'true'.lower() or 'false'.lower()

            if (
                status.toLowerCase() !== 'true' &&
                status.toLowerCase() !== 'false'
            ) {
                return '您输入的参数不合法,参数只能为 true 或者 false'
            }

            await chain.receiveCommand(session, 'set_auto_update_room', {
                room_resolve: {
                    name: options.room
                },
                auto_update_room: status.toLowerCase() === 'true'
            })
        })

    ctx.command(
        'chatluna.room.kick <...arg:user>',
        '踢出某个人员在你当前的房间'
    ).action(async ({ session }, ...user) => {
        const users = user.map((u) => u.split(':')[1])
        await chain.receiveCommand(session, 'kick_member', {
            resolve_user: {
                id: users
            }
        })
    })

    ctx.command('chatluna.room.invite <...arg:user>', '邀请进入房间').action(
        async ({ session }, ...user) => {
            const users = user.map((u) => u.split(':')[1])
            await chain.receiveCommand(session, 'invite_room', {
                resolve_user: {
                    id: users
                }
            })
        }
    )

    ctx.command('chatluna.room.join <id:text>', '加入某个房间').action(
        async ({ session }, name) => {
            await chain.receiveCommand(session, 'join_room', {
                room_resolve: {
                    name
                }
            })
        }
    )

    ctx.command('chatluna.room.leave [room:text]', '离开当前房间').action(
        async ({ session, options }, room) => {
            await chain.receiveCommand(session, 'leave_room', {
                room_resolve: {
                    name: room,
                    id: room
                }
            })
        }
    )

    ctx.command('chatluna.room.clear [room:text]').action(
        async ({ session }, room) => {
            await chain.receiveCommand(session, 'clear_room', {
                room_resolve: {
                    name: room
                }
            })
        }
    )

    ctx.command('chatluna.room.set', '设置房间的属性')
        .option('name', '-n <name:string> 房间名字')
        .option('preset', '-p <preset:string> 房间预设')
        .option('model', '-m <model:string> 房间模型')
        .option('chatMode', '-c <chatMode:string> 房间聊天模式')
        .option('password', '-w <password:string> 房间密码')
        .option('visibility', '-v <visibility:string> 房间可见性')
        .action(async ({ session, options }) => {
            await chain.receiveCommand(session, 'set_room', {
                room_resolve: {
                    name: options.name ?? undefined,
                    preset: options.preset ?? undefined,
                    model: options.model ?? undefined,
                    chatMode: options.chatMode ?? undefined,
                    password: options.password ?? undefined,
                    visibility: options.visibility ?? undefined
                }
            })
        })

    ctx.command('chatluna.room.list', '列出所有你加入的房间')
        .option('page', '-p <page:number> 页码')
        .option('limit', '-l <limit:number> 每页数量')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_room', {
                page: options.page ?? 1,
                limit: options.limit ?? 2
            })
        })

    ctx.command('chatluna.room.transfer <arg:user>', '转移房间的房主').action(
        async ({ session }, user) => {
            await chain.receiveCommand(session, 'transfer_room', {
                resolve_user: {
                    id: user.split(':')[1]
                }
            })
        }
    )

    ctx.command('chatluna.room.info [room:text]', '查看当前房间的信息').action(
        async ({ session }, room) => {
            await chain.receiveCommand(session, 'room_info', {
                room_resolve: {
                    name: room
                }
            })
        }
    )

    ctx.command(
        'chatluna.room.switch <name:text>',
        '切换到你已经加入了的房间'
    ).action(async ({ session }, name) => {
        await chain.receiveCommand(session, 'switch_room', {
            room_resolve: {
                name,
                id: name
            }
        })
    })

    ctx.command(
        'chatluna.room.permission <user:user>',
        '修改房间里某人的权限'
    ).action(async ({ session }, user) => {
        await chain.receiveCommand(session, 'room_permission', {
            resolve_user: {
                id: user.split(':')[1]
            }
        })
    })

    ctx.command('chatluna.room.mute <...user:user>', '禁言某个用户，不让其发言')
        .option('room', '-r <room:string> 指定房间')
        .action(async ({ session, options }, ...user) => {
            await chain.receiveCommand(session, 'mute_user', {
                room_resolve: {
                    name: options.room
                },
                resolve_user: {
                    id: user.map((u) => u.split(':')[1])
                }
            })
        })
}
