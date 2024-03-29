import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna.preset', 'chatluna 预设相关指令', {
        authority: 1
    })

    ctx.command('chatluna.preset.list', '列出所有目前支持的预设')
        .option('page', '-p <page:number> 页码')
        .option('limit', '-l <limit:number> 每页数量')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_preset', {
                page: options.page ?? 1,
                limit: options.limit ?? 3
            })
        })

    ctx.command('chatluna.preset.add <preset:string>', '添加一个预设').action(
        async ({ session }, preset) => {
            await chain.receiveCommand(session, 'add_preset', {
                addPreset: preset
            })
        }
    )

    ctx.command(
        'chatluna.preset.clone <originPreset:string> [newPresetName:string]',
        '克隆预设',
        {
            authority: 3
        }
    ).action(async ({ session }, preset, newPreset) => {
        await chain.receiveCommand(session, 'clone_preset', {
            clonePreset: {
                name: preset,
                newName: newPreset ?? preset + '(1)'
            }
        })
    })

    ctx.command('chatluna.preset.set <preset:string>', '修改一个预设', {
        authority: 3
    }).action(async ({ session }, preset) => {
        await chain.receiveCommand(session, 'set_preset', {
            setPreset: preset
        })
    })

    ctx.command('chatluna.preset.delete <preset:string>', '删除一个预设', {
        authority: 3
    }).action(async ({ session }, preset) => {
        await chain.receiveCommand(session, 'delete_preset', {
            deletePreset: preset
        })
    })
}
