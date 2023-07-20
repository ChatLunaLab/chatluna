import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';
import { ChatMode } from '../middlewares/resolve_conversation_info';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listpreset", "列出所有目前支持的预设")
        .alias("预设列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listPreset"
            )
        })


    ctx.command("chathub.addpreset <preset:string>", "添加一个预设")
        .alias("添加预设")
        .action(async ({ session }, preset) => {
            await chain.receiveCommand(
                session, "add_preset", {
                addPreset: preset,
            }
            )
        })

    ctx.command("chathub.deletepreset <preset:string>", "删除一个预设")
        .alias("删除预设")
        .action(async ({ session }, preset) => {
            await chain.receiveCommand(
                session, "delete_preset", {
                deletePreset: preset,
            }
            )
        })
}