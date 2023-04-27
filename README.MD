
<div align="center">

# koishi-plugin-chathub

_可接入多种模型以实现聊天服务的Koishi插件。_

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub) [![npm](https://img.shields.io/npm/dt/@dingyi222666/koishi-plugin-chathub)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub) ![node version](https://img.shields.io/badge/node-%3E=16.8-green)

**该插件仍在开发中，可能含有诸多bug，请善用issues反馈，也欢迎提pr来共同完善本插件**

</div>

### 特性

- 开放模型适配器API，轻松实现多平台支持，可自主接入模型聊天服务，其他插件也可调用本插件开放的服务
- 支持设置Bot人设（需要对接的模型适配器的支持），支持发送消息以实现动态切换人设，默认人设为猫娘
- 开放模型数据注入API，使得模型可以网络搜索（仍在完善），也可自主接入
- 上下文对话支持 (需要对接的模型适配器的支持)
- 支持按小时的限制调用额度，基于Koishi的计算属性，可以轻松针对某个平台，某个用户和某个群进行限制



### TODO (画饼是吧)

- [x] 群共享对话/隔离对话
- [x] 回复内容审核 (基于其他插件提供的censor服务)
- [ ] 语音输出支持（即文字转语音）（但是可能只提供服务支持，允许第三方接入具体实现）
- [ ] 接入更多模型/平台
- [ ] 导入或导出会话记录
- [ ] 图片渲染回复
- [ ] Bot人设优化，支持设置示范对话

### 部署

#### 环境要求

```
koishi >= 4.12
nodejs >= 16.8
```

由于koishi平台的插件市场的友好性和便捷性，所以我们可以在koishi下快速的安装本插件而无需额外的复杂配置。

首先前往koishi平台的插件市场，搜索`chathub`，然后安装以下插件：

1. 核心服务支持插件：`@dingyi222666/chathub`
2. 模型适配器插件：`@dingyi222666/chathub-xxx-adapter` (xxx为目前我们支持的模型适配器的名称，见下表)
3. 安装上面的插件，并且在安装好插件所需要的其他插件（例如`@dingyi222666/chathub`插件依赖`cache`服务，你需要安装一个提供了`cache`服务的插件）。
4. 配置好插件和适配器。（具体配置基本上描述都有写到，如果没有的话可能需要自己摸索了（我暂时还没空写这块的doc））
5. 请设置一个适配器为默认选择的适配器(适配器的
    全局设置 -> isDefault
这里，开启就行)，不然的话没有默认的适配器无法直接聊天

接下来就可以使用本插件了，尝试向Bot交流，并观察Log的输出（如果有bug请告诉我！使用不稳定的话推荐打开调试模式以获得更详细的Log日志好向我反馈）。

### 适配支持

我们目前支持以下模型/平台

|  模型/平台  |  接入方式  |  特性  |  注意事项  |
|:----------|:----------|-------|:----------|
| [OpenAI (GPT-3/GPT3.5)](/packages/openai-adapter/README.md) | 本地Client，官方API接入 | 可自定义人格 | API接入需要付费 |
| [New Bing](/packages/newbing-adapter/README.md) | 本地Client，逆向API接入 | 自带网络搜索，强时效性 | 需要有NewBing的账号 |
| [poe.com](/packages/poe-adapter/README.md) | 本地Client，逆向API接入 | 网站可选多种模型，和New Bing一样免费 | 需要有poe.com的账号 |

[网络搜索注入](/packages/search-service/README.md)我们支持：

- Baidu (Web)
- Bing (Web)
- DuckDuckGO (Lite & Web)

### 手动接入其他模型

等待施工...

### 感谢

本项目在编写时参考了其他开源项目，特别感谢以下项目：

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[node-chatgpt-api](https://github.com/waylaidwanderer/node-chatgpt-api)

[poe-api](https://github.com/ading2210/poe-api)
