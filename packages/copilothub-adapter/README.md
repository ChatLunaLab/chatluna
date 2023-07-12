## koishi-plugin-chathub-copilothub-adapter

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub-copilothub-adapter)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-copilothub-adapter) [![npm](https://img.shields.io/npm/dm/@dingyi222666/koishi-plugin-chathub-copilothub-adapter)](https://www.npmjs.com/package//@dingyi222666/koishi-plugin-chathub-copilothub-adapter)

> 为chathub提供Copilot Hub支持的适配器

**目前本插件暂时不在维护，因为我没有相关的API KEY供测试，如果你使用此插件发现了Bug，请联系我时顺便附上可供我测试用的API KEY，谢谢。**

## 怎么使用？

1. 在插件市场安装本插件(`chathub-copilothub-adapter`)，并安装好本插件依赖的前置插件。

2. 获取到Copilot Hub Bot 的 API KEY，填写到插件的设置中（全局设置 -> apiKey）

3. 如果需要设置代理的话，推荐在`chathub`主插件里设置里设置代理(请求设置 -> isProxy，请求设置 -> proxyAddress)

4. 如果想默认使用Copilot Hub的话，需要使用命令设置为默认的适配器

5. 现在你可以尝试回复Bot一句你好，如果Bot响应了你，那么恭喜你，你已经成功接入了Copilot Hub。

## 常见问题

### 什么是`注入Prompt` ？

其实注入Prompt指的就是是否能类似OpenAI的适配器一样能注入信息 （并且开启后会尝试自维护上下文）

需要注意的是这个功能并不一定有效，建议谨慎使用。
