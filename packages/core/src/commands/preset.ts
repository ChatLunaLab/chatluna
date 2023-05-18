import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listPreset", "列出所有目前支持的预设")
        .alias("预设列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listPreset"
            )
        })

    
}