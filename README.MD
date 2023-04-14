## koishi-plugin-chathub

**该插件仍在开发中，可能含有诸多bug，请善用issues反馈，也欢迎提pr**

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub) [![npm](https://img.shields.io/npm/dt/@dingyi222666/koishi-plugin-chathub)](https://www.npmjs.com/package//@dingyi222666/koishi-plugin-chathub)

可接入多种模型以实现聊天服务的Koishi插件。**暂无本地化语言支持的打算**

### 特性

- 开放模型适配器API，轻松实现多平台支持，可自主接入模型聊天服务，其他插件也可调用本插件开放的服务
- 支持设置Bot人设，支持动态切换人设，默认人设为猫娘
- 开放模型数据注入API，使得模型可以网络搜索（仍在完善），也可自主接入
- 上下文对话支持 (也需要对接的模型适配器的支持)
- 支持按小时的限制调用额度，基于Koishi的计算属性，可以轻松针对某个平台，某个用户和某个群进行限制

### TODO (画饼是吧)

- [ ] 群共享对话/隔离对话
- [ ] 文字转语音的API（但是可能只提供服务支持，允许第三方接入具体实现）
- [ ] 接入更多模型/平台
- [ ] 导入或导出会话记录
- [ ] 图片渲染回复

### 适配支持

我们目前支持以下模型/平台

- [OpenAI GPT-3/GPT3.5](/packages/openai-adapter/README.md)

- [New Bing](/packages/newbing-adapter/README.md)

[网络搜索注入](/packages/search-service/README.md)我们支持：

- Baidu (Web)
- Bing (Web)

### 配置

- [OpenAI GPT-3/GPT3.5](/packages/openai-adapter/README.md)
- [New Bing](/packages/newbing-adapter/README.md)
- [网络搜索注入](/packages/search-service/README.md)

### 手动接入其他模型

等待施工...

### 感谢

本项目在编写时参考了其他开源项目，特别感谢以下项目：

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[node-chatgpt-api](https://github.com/waylaidwanderer/node-chatgpt-api)
