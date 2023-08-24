## koishi-plugin-chathub-newbing-adapter

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub-newbing-adapter/next)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-newbing-adapter) [![npm](https://img.shields.io/npm/dm/@dingyi222666/koishi-plugin-chathub-newbing-adapter)](https://www.npmjs.com/package//@dingyi222666/koishi-plugin-chathub-newbing-adapter)

> 为 ChatHub提供 New Bing 支持的适配器

## 怎么使用？

1. 在插件市场安装本插件(`@dingyi222666/chathub-newbing-adapter`)，并安装好本插件依赖的前置插件
2. 获取到已经有 New Bing 访问权限账号的在 Bing 网站上登录的 Cookie (可以参考 [这里](https://forum.koishi.xyz/t/topic/2884/5))
3. 在插件的设置中填写你的 Cookie（请求设置 -> cookie。也可以不填写 Cookie，目前 New Bing 支持免登录使用
4. 国内环境需要设置代理，请在`chathub`主插件里设置里设置代理(请求设置 -> isProxy，请求设置 -> proxyAddress)
5. 如果想默认使用 New Bing 的话，需要使用命令设置为默认的适配器。
6. 现在你可以尝试回复 Bot 一句 Bing AI，如果Bot响应了你，那么恭喜你，你已经成功接入了 New Bing。

## 常见问题

### 什么是 Sydeny 模式？

Syndeny模式会通过某些方式突破 New Bing 的限制，理论上可以做到：

1. 支持上下文对话，不再局限于30次限制（但是仍然是有限的，历史聊天记录容量太大就可能会清空对话）
2. 人格设定，设置系统 Pormpt，默认设置为 Sydeny

而且打开此功能突破了限制后账号可能会有风险，请谨慎使用。
