## koishi-plugin-chathub-openai-adapter

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub-openai-adapter/next)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-openai) [![npm](https://img.shields.io/npm/dm/@dingyi222666/koishi-plugin-chathub-openai-adapter)](https://www.npmjs.com/package//@dingyi222666/koishi-plugin-chathub-openai-adapter)

> 为 ChatHub 提供 OpenAI GPT 3.5 / GPT 4 支持的适配器

## 怎么使用？

1. 请先获取你的 OpenAI API Key，怎么获取这里不再赘述
2. 在插件市场安装本插件(`@dingyi222666/chathub-openai-adapter`)，并安装好本插件依赖的前置插件
3. 在插件配置中填写你的 API Key（请求设置 -> apiKey）
4. 如果想默认使用 Open AI 服务的话，需要使用命令设置为默认的适配器。
5. 现在你可以尝试回复 Bot 一句你好，如果Bot响应了你，那么恭喜你，你已经成功接入了 OpenAI。

## 常见问题

### 国内环境怎么使用？

你可以在 Koishi 的全局设置里设置代理。当然我们更推荐你设置反代（请求设置 -> apiEndPoint）。这样本地就不需要开代理。
