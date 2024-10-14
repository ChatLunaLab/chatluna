## koishi-plugin-chatluna-gptfree-adapter

## [![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-gptfree-adapter)](https://www.npmjs.com/package/koishi-plugin-chatluna-gptfree-adapter) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna-gptfree-adapter)](https://www.npmjs.com/package//koishi-plugin-chatluna-gptfree-adapter)

> 为 ChatLuna 提供 gptfree-ts 支持的适配器

## 怎么使用？

1. 你需要**自搭建 gptfree-ts 后端服务**，本插件基于[此](https://github.com/xiangsx/gpt4free-ts)后端服务，请按该项目的说明搭建后端服务（如果有其他人搭建了此后端服务，你也可以使用他人的后端服务）。
2. 在插件市场安装本插件(`chatluna-gptfree-adapter`)，并安装好本插件依赖的前置插件。
3. 在插件配置中填写你的后端服务（或者他人搭建的部署在公网）的访问地址，并且填写你的后端服务的访问token。
4. 如果想默认使用此插件的的话，需要使用命令设置为默认的适配器。
5. 现在你可以尝试回复 Bot 一句你好，如果 Bot 响应了你，那么恭喜你，你已经成功接入了 gptfree。

**由于该插件的网络请求依然是基于`core`插件的代理设置配置的，如果你是本地搭建的后端服务，注意不要让代理给代理了你的后端服务的请求地址（`localhost`，局域网）**

## 常见问题

### 搭建后端服务的最低配置要求？

此服务无需显卡也可运行，是连接到其他网站提供的服务的。

对话的历史记录是保存在本地 Client 上的，因此只需要跑上后端服务就行了。
