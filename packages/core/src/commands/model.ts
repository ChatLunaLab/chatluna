import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    ctx.command('chathub.model', 'chathub 模型相关指令', {
        authority: 1,
    })

    ctx.command("chathub.model.list", "列出所有目前支持的模型")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "list_model"
            )
        })


}