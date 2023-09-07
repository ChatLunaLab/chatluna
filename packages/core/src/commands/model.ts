import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    ctx.command('chathub.model', 'chathub 模型相关指令', {
        authority: 1,
    })

    ctx.command("chathub.model.list", "列出所有目前支持的模型")
        .option("page", "-p <page:number> 页码")
        .option("limit", "-l <limit:number> 每页数量")
        .action(async ({ options, session }) => {
            await chain.receiveCommand(
                session, "list_model", {
                page: options.page ?? 1,
                limit: options.limit ?? 5,
            })
        })


}