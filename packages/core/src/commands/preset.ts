import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna.preset', { authority: 1 })

    ctx.command('chatluna.preset.list')
        .option('page', '-p <page:number>')
        .option('limit', '-l <limit:number>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(session, 'list_preset', {
                page: options.page ?? 1,
                limit: options.limit ?? 3
            })
        })

    ctx.command('chatluna.preset.add <preset:string>').action(
        async ({ session }, preset) => {
            await chain.receiveCommand(session, 'add_preset', {
                addPreset: preset
            })
        }
    )

    ctx.command(
        'chatluna.preset.clone <originPreset:string> [newPresetName:string]',
        { authority: 3 }
    ).action(async ({ session }, preset, newPreset) => {
        await chain.receiveCommand(session, 'clone_preset', {
            clonePreset: {
                name: preset,
                newName: newPreset ?? preset + '(1)'
            }
        })
    })

    ctx.command('chatluna.preset.set <preset:string>', { authority: 3 }).action(
        async ({ session }, preset) => {
            await chain.receiveCommand(session, 'set_preset', {
                setPreset: preset
            })
        }
    )

    ctx.command('chatluna.preset.delete <preset:string>', {
        authority: 3
    }).action(async ({ session }, preset) => {
        await chain.receiveCommand(session, 'delete_preset', {
            deletePreset: preset
        })
    })
}
