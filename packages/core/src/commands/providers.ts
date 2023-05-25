import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listEmbeddings", "列出所有目前支持的嵌入模型")
        .alias("嵌入模型列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listEmbeddings"
            )
        })

}