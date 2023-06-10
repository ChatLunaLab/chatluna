## koishi-plugin-chathub-chatglm-adapter

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub-chatglm-adapter)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub-chatglm-adapter) [![npm](https://img.shields.io/npm/dt/@dingyi222666/koishi-plugin-chathub-chatglm-adapter)](https://www.npmjs.com/package//@dingyi222666/koishi-plugin-chathub-chatglm-adapter)

> 为chathub提供ChatGLM支持的适配器

## 怎么使用？

1. 你需要**自搭建ChatGLM后端服务**，本插件基于[此](https://github.com/ninehills/chatglm-openai-api)后端服务，请按该项目的说明搭建后端服务（如果有其他人搭建了此后端服务，你也可以使用他人的后端服务）。
2. 在插件市场安装本插件(`chathub-chatglm-adapter`)，并安装好本插件依赖的前置插件。
3. 在插件配置中填写你的后端服务（或者他人搭建的部署在公网）的访问地址，并且填写你的后端服务的访问token。
4. 如果想默认使用ChatGLM服务的话，需要使用命令设置为默认的适配器。
5. 现在你可以尝试回复Bot一句你好，如果Bot响应了你，那么恭喜你，你已经成功接入了ChatGLM。

**由于该插件的网络请求依然是基于`core`插件的代理设置配置的，如果你是本地搭建的后端服务，注意不要让代理给代理了你的后端服务的请求地址（`localhost`，局域网）**

## 常见问题

### 搭建后端服务的最低配置要求？

最低要求含有6GB显存的消费级显卡（N卡优先），推荐使用12G显存的显卡。

如果你的本地配置不够，你可以自行尝试在Google Colab，AutoDL之类的平台上搭建后端服务。

对话的历史记录是保存在本地Client上的，因此只需要跑上后端服务就行了。

