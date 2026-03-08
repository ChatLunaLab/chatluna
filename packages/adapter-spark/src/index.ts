import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { SparkClient } from './client'
import { SparkClientConfig } from './types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import {
    defaultSparkAppConfig,
    hasSparkModelPassword,
    sparkModelCatalog
} from './utils'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-spark-adapter')
    ctx.on('ready', async () => {
        const plugin = new ChatLunaPlugin<SparkClientConfig, Config>(
            ctx,
            config,
            'spark'
        )

        plugin.parseConfig((config) => {
            return config.appConfigs
                .filter(
                    (apiKeys) =>
                        apiKeys.enabled !== false &&
                        sparkModelCatalog.some((model) => {
                            return hasSparkModelPassword(apiKeys, model.name)
                        })
                )
                .map((apiKeys) => {
                    return {
                        apiKey: undefined,
                        apiEndpoint: undefined,
                        platform: 'spark',
                        chatLimit: config.chatTimeLimit,
                        timeout: config.timeout,
                        maxRetries: config.maxRetries,
                        concurrentMaxSize: config.chatConcurrentMaxSize,
                        apiPasswords: apiKeys
                    }
                })
        })

        plugin.registerClient(() => new SparkClient(ctx, config, plugin))

        await plugin.initClient()
    })
}

export interface Config extends ChatLunaPlugin.Config {
    appConfigs: (Record<string, string> & { enabled?: boolean })[]
    maxContextRatio: number
    temperature: number
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,
    Schema.object({
        appConfigs: Schema.array(
            Schema.dict(String)
                .default({ ...defaultSparkAppConfig })
                .role('table')
        ).default([{ ...defaultSparkAppConfig }])
    }),
    Schema.object({
        maxContextRatio: Schema.number()
            .min(0)
            .max(1)
            .step(0.0001)
            .role('slider')
            .default(0.35),
        temperature: Schema.percent().min(0.1).max(1).step(0.01).default(1)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const usage = `
## 讯飞星火适配器填写说明

**appConfigs 配置说明：**
- 每一行都是一组独立的模型密码配置
- 左边填写模型别名，右边填写该模型在讯飞控制台里对应的 APIPassword
- 只有填写了非空密码的模型，才会出现在 ChatLuna 的模型列表里

### 模型别名与讯飞控制台的对应关系

访问 https://console.xfyun.cn/services/bm4 进入星火调试中心，在下方服务列表中找到对应模型，点进去复制 APIPassword。

| ChatLuna 模型别名 | 讯飞控制台模型名称 | 说明 |
|-----------------|-----------------|------|
| spark-lite | Spark Lite | 免费模型，响应速度快 |
| spark-pro | Spark Pro | 强性能模型，速度快效果好 |
| spark-pro-128k | Spark Pro-128K | Pro 的 128K 长文本版本 |
| spark-max | Spark Max | 性能最强的基础模型 |
| spark-max-32k | Spark Max-32K | Max 的 32K 长文本版本 |
| spark-4.0-ultra | Spark Ultra-32K | 高性价比模型，指令跟随和文本生成能力强 |
| spark-x1.5 | Spark X1.5 | 支持快慢思考自主决策，语言理解和任务规划能力显著提升 |
| spark-x2 | Spark X2 | 最新发布性能最强的深度推理模型，数学、推理、语言理解、智能体等方向效果重点提升 |

### 怎么填

1. 进入 https://console.xfyun.cn/services/bm4 找到你要用的模型，复制 APIPassword。
2. 在 appConfigs 中找到对应的模型别名，填入密码。
3. 如果配置里没有，就自己添加（参考上面表格）。
4. 只有填写密码的模型才会显示。

### 升级说明

从旧版本升级到此版本，需要重新安装适配器。

### 文档参考

- 常规 HTTP 文档：https://www.xfyun.cn/doc/spark/HTTP调用文档.html#_1-接口说明
- X1.5 / X2 HTTP 文档：https://www.xfyun.cn/doc/spark/X1http.html#_2、请求示例
`

export const inject = ['chatluna']

export const name = 'chatluna-spark-adapter'
