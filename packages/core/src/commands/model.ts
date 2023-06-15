import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listmodel", "列出所有目前支持的模型")
        .alias("模型列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "list_model"
            )
        })

    ctx.command("chathub.setmodel <model>", "设置当前群聊/私聊默认使用的模型")
        .alias("切换模型")
        .option("global", "-g 也设置为全局会话默认的模型？")
        .action(async ({ session, options }, model) => {
            await chain.receiveCommand(
                session, "set_default_model", {
                setModel: model,
                setModelAndForce: options.global
            })
        }
        )
}