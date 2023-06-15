import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listModel", "列出所有目前支持的模型")
        .alias("模型列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listModel"
            )
        })

    ctx.command("chathub.setModel <model>", "设置当前默认使用的模型")
        .alias("切换模型")
        .option("all", "-a 强制应用到其他会话？")
        .action(async ({ session, options }, model) => {
            await chain.receiveCommand(
                session, "setDefaultModel", {
                setModel: model,
                setModelAndForce: options.all
            })
        }
        )
}