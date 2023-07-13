## koishi-plugin-chathub-claude2-adapter

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub-claude2-adapter/next)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-claude2-adapter) [![npm](https://img.shields.io/npm/dm/@dingyi222666/koishi-plugin-chathub-claude2-adapter)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-claude2-adapter)

> 为chathub提供New Bing支持的适配器

## 怎么使用？

1. 在插件市场安装本插件(`chathub-cluade2-adapter`)，并安装好本插件依赖的前置插件
2. 获取到已经有 Cluade2 访问权限账号的在 Calude 网站的 Cookie。只需要获取到 Cookie 里面 `sessionKey` 的值然后填入进去就行了。
3. 在插件的设置中填写你的 Cookie
4. 国内环境需要设置代理，请在`chathub`主插件里设置里设置代理(请求设置 -> isProxy，请求设置 -> proxyAddress)
5. 如果想默认使用 Claude 2 的话，需要使用命令设置为默认的适配器。
6. 现在你可以尝试回复 Bot，如果Bot响应了你，那么恭喜你，你已经成功接入了 Claude 2。

## 常见问题

### 待续