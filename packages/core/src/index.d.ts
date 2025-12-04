import { Context, Logger } from 'koishi'
import { Config } from './config'
export * from './config'
export * from './render'
export * from './types'
export * from '@vue/reactivity'
export declare const name = 'chatluna'
export declare const inject: {
    required: string[]
    optional: string[]
}
export declare const inject2: {
    database: {
        required: boolean
    }
    censor: {
        required: boolean
    }
    vits: {
        required: boolean
    }
    chatluna_storage: {
        required: boolean
    }
}
export declare let logger: Logger
export declare const usage =
    '\n## chatluna v1.3 beta\n\nChatLuna \u63D2\u4EF6\u4EA4\u6D41 QQ \u7FA4\uFF1A282381753 \uFF08\u6709\u95EE\u9898\u6216\u51FA\u73B0 Bug \u5148\u52A0\u7FA4\u95EE\uFF09\n\n\u7FA4\u91CC\u76EE\u524D\u6CA1\u6709\u642D\u8F7D\u8BE5\u63D2\u4EF6\u7684 bot\uFF0C\u52A0\u7FA4\u7684\u8BDD\u6700\u597D\u662F\u6765\u8BE2\u95EE\u95EE\u9898\u6216\u8005\u63D0\u51FA\u610F\u89C1\u7684\u3002\n\n\u8BBF\u95EE [https://chatluna.chat](https://chatluna.chat) \u6765\u4E86\u89E3\u5982\u4F55\u4F7F\u7528 Chatluna\u3002\n\u4E5F\u53EF\u4EE5\u8BBF\u95EE [https://preset.chatluna.chat](https://preset.chatluna.chat) \u8FDB\u5165\u5728\u7EBF\u9884\u8BBE\u7F16\u8F91\u5668\u3002\u66F4\u6709\u9884\u8BBE\u5E7F\u573A\u6765\u6D4F\u89C8\u548C\u4E0B\u8F7D\u4F60\u5FC3\u4EEA\u7684\u9884\u8BBE\u3002\n'
export declare function apply(ctx: Context, config: Config): void
