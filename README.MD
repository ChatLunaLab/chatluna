
<div align="center">

# koishi-plugin-chathub

_多平台模型接入，可扩展，多种输出格式，由 LangChain 驱动开发，提供语言模型聊天服务的 Koishi 插件。_

## [![npm](https://img.shields.io/npm/v/@dingyi222666/koishi-plugin-chathub/next)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub) [![npm](https://img.shields.io/npm/dm/@dingyi222666/koishi-plugin-chathub)](https://www.npmjs.com/package/@dingyi222666/koishi-plugin-chathub) ![node version](https://img.shields.io/badge/node-%3E=18-green) ![github top language](https://img.shields.io/github/languages/top/dingyi222666/koishi-plugin-chathub?logo=github)

**当前项目状态：缓慢迭代到 1.0 正式版**

</div>

[文档地址](https://chathub.dingyi222666.top/)
仍在施工中.....

### 截图

施工中.....

### 特性

- 高扩展性，基于 LangChain 和 Koishi，我们提供了一套扩展 API，让第三方插件开发者可以轻松的扩展或调用此项目的服务。如 调用模型，对接新模型等
- 预设系统，可设置对话的预设，调教模型。
- 黑名单系统，全局冷却时间和模型并发请求限制，以及按小时的模型的调用额度限制，轻松管理模型的调用限额等。
- 支持 语音/文字/图片/图文混合 回复，也支持解析返回的 markdown ，实现比较自然的分割成多条消息来发送
- 上下文对话，长期记忆的支持 （需要适配器支持）
- 三种聊天模式: `chat`,`browsing`,`plugin`

    后两种模式可让模型调用外部工具，使得模型能获取到外部信息，执行相关操作等。

- 内容安全过滤，基于 Koishi 的 [censor 服务](`https://censor.koishi.chat/`), 防止模型返回不良内容

### TODO (画饼是吧)

- [x] 基于房间的对话系统
- [x] 回复内容审核 (基于其他插件提供的 censor 服务)
- [x] 语音输出支持（即文字转语音）(基于 initialencounter 佬的 [vits服务](https://github.com/initialencounter/mykoishi/blame/master/vits/readme.md)，可在 Koishi 插件市场搜索 `open-vits`来使用可开箱即用的 vits 服务)
- [x] 图片渲染回复
- [x] 接入更多模型/平台
- [x] 预设系统
- [x] 导入或导出会话记录（实际未完成，已暂时放弃支持）
- [x] 重构到 v1 版本
- [x] 流式响应支持
- [ ] i18n 本地化支持

### 部署

#### 环境要求

```text
koishi >= 4.14
nodejs >= 18
```

由于 Koishi 平台的插件市场的友好和便捷，我们可在 Koishi 下直接安装本插件使用基础功能而无需额外配置。

前往 Koishi 控制台的插件市场，搜索 `chathub`，然后按下面顺序操作：

1. 安装核心服务支持插件：`@dingyi222666/chathub`
2. 安装模型适配器插件：`@dingyi222666/chathub-xxx-adapter` (xxx 为目前我们支持的模型适配器的名称，见下表)
3. 按上面的顺序依次安装插件（注意安装后了要先启用插件了然后在下一步），然后在安装好插件所需要的其他插件（也就是插件的必须服务）（例如`@dingyi222666/chathub`插件依赖`cache`服务，你需要安装一个提供了`cache`服务的插件）。
4. 配置好插件和适配器。（具体配置基本上描述都有写到，如果没有的话可能需要自己摸索了（我暂时还没空写这块的文档））
5. 先启动主插件，然后在主插件上配置好模板房间使用的模型，预设等，然后保存。

接下来就可以使用本插件了。

### 适配支持

我们目前支持以下模型/平台：

|  模型/平台  |  接入方式  |  特性  |  注意事项  |
|:----------|:----------|-------|:----------|
| [OpenAI (GPT-3/GPT3.5)](/packages/openai-adapter/README.md) | 本地 Client，官方 API 接入 | 可自定义人格，支持插件/浏览模式等聊天模式 | API 接入需要付费 |
| [New Bing](/packages/newbing-adapter/README.md) | 本地 Client，逆向 API 接入 | 自带网络搜索，强时效性，可无需登录使用 | 需要代理（无需 Cookie 也可用） |
| [Google Bard](/packages/bard-adapter/README.md) | 本地 Client，逆向 API 接入 | 和 New Bing 一样可以网络搜索，强时效性 | 需要有 Bard 访问权限账号，只能英文交流 |
| [Claude 2](/packages/claude2-adapter/) | 本地 Client，逆向 API 接入 | 超大上下文，大部分情况下能超过 GPT 3.5，类似 New Bing 有账号就行，免费 | 需要有 Claude 2 访问权限账号。后续可能会有限流 |
| [poe.com](/packages/poe-adapter/README.md) | 本地 Client，逆向 API 接入 | 网站可选多种模型，和 New Bing 一样免费 | 需要有 [poe.com](poe.com) 的账号 |
| [讯飞星火](/packages/spark-adapter/README.md) | 本地 Client，官方 API 接入 | 国产模型，新人注册可获取免费 Token 额度 | 实测效果约等于 GPT 3.5，有部分场景不如 GPT 3.5 |
| [GPT Free](/packages/gptfree-adapter/README.md) | 本地 Client，官方 API 接入 | 本地转发使用其他网站的 GPT 模型，项目自动配置网站等配置，无需手动注册 | 可能随时失效，不稳定 |
| [ChatGLM](/packages/chatglm-adapter/README.md) | 本地 Client，自搭建后端 API 接入 | 可本地搭建，四舍五入不要钱 | 需要自己搭建后端 API，要求一定的配置，6B参数聊天效果不够好 |
| [RWKV](/packages/rwkv-adapter/README.md) | 本地 Client，自搭建 API 接入 | 知名开源模型，可本地搭建 |  需要自己搭建后端 API，要求一定的配置 |
| [lmsys](/packages/lmsys-adapter/README.md) | 本地 Client，逆向 API 接入 | 该平台提供了主流的开源模型的免费试用 | 可能需要代理，网站上的开源模型效果与 Open AI 的可能还有差距 |

[为模型提供网络搜索能力](/packages/search-service/README.md) 我们支持：

- Baidu (Web)
- Bing (Web)
- DuckDuckGO (Lite & Web)
- Google (Api)
- Bing (Api)

### 人格预设

从`1.0.0-alpha.10`版本开始，我们支持更加可定制化的人格预设。新的人格预设使用 yaml。

你可以点这里来查看我们默认附带的人格文件：[catgirl.yml](/packages/core/resources/presets/catgirl.yml)

我们默认的预设文件夹路径为 `你当前运行插件的 koishi 目录的路径+/data/chathub/presets`。

所有的预设文件都是从上面的文件夹上加载的。因此你可以自由添加和编辑预设文件在这个文件夹下，然后使用命令来切换人格预设。

**不是所有的适配器都支持预设，目前 Bard，Copliot Hub 不支持！**

### 手动接入其他模型

等待施工....

### 贡献者名单

<a href="https://github.com/ChatHubLab/chathub/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatHubLab/chathub" />
</a>

### 感谢

本项目在编写时参考了其他开源项目，特别感谢以下项目：

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[node-chatgpt-api](https://github.com/waylaidwanderer/node-chatgpt-api)

[poe-api](https://github.com/ading2210/poe-api)

[Bard](https://github.com/acheong08/Bard)

[chathub](https://github.com/chathub-dev/chathub)
