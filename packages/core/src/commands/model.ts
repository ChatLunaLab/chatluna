import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listmodel", "列出所有目前支持的模型")
        .alias("模型列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "list_model"
            )
        })


}