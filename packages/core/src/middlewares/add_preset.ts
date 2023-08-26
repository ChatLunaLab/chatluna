import { Context } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';
import { getPresetInstance } from '..';
import { dump } from 'js-yaml'
import fs from 'fs/promises'
import { randomUUID } from 'crypto';

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("add_preset", async (session, context) => {

        const { command } = context

        if (command !== "add_preset") return ChainMiddlewareRunStatus.SKIPPED

        const presetName = context.options.addPreset

        const preset = getPresetInstance()

        try {
            await preset.getPreset(presetName)

            await context.send("该预设关键词已经和其他预设关键词冲突，请更换其他关键词重试哦")

            return ChainMiddlewareRunStatus.STOP
        } catch (e) {

        }

        await context.send("请发送你的预设内容。")

        const result = await session.prompt(1000 * 30)

        if (!result) {
            context.message = `添加预设超时，已取消添加预设: ${presetName}`
            return ChainMiddlewareRunStatus.STOP
        }

        const presetObject = {
            keywords: [presetName],
            prompts: [
                {
                    role: "system",
                    content: result
                }
            ]
        }

        const yamlText = dump(presetObject)

        await fs.writeFile(preset.resolvePresetDir() + `/${presetName}.yml`, yamlText)

        context.message = `预设添加成功，预设名称为: ${presetName}。 请调用预设列表命令查看。`

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "add_preset": string
    }

    interface ChainMiddlewareContextOptions {
        addPreset?: string
    }
}