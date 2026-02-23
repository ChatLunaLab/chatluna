<div align="center">

<img src="./resources/logo.png" alt="项目图标" title="项目图标" width="300" />

中文 | [English](./README_EN.MD) | [日本語](./README_JP.MD)

#

_多平台模型接入，可扩展，多种输出格式，提供大语言模型聊天服务的机器人插件。_

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna)](https://www.npmjs.com/package/koishi-plugin-chatluna) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna)](https://www.npmjs.com/package/koishi-plugin-chatluna)

![node version](https://img.shields.io/badge/node-%3E=18-green) ![github top language](https://img.shields.io/github/languages/top/ChatLunaLab/chatluna?logo=github)

[![Telegram](https://img.shields.io/badge/Join-Telegram_Group-blue)](https://t.me/koishi_chatluna) [![QQ](https://img.shields.io/badge/Join-QQ_Group-ff69b4)](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=eEBVq6GK7HYX2y61x55WD6hnXTIRop-0&authKey=i4pG5%2BJ%2FY8auWprBubhremTkn3vroPigQq5m9RENGBLrLmlj%2BSu3G%2BqllK7Wts2M&noverify=0&group_code=282381753) [![doc](https://img.shields.io/badge/See-Document-green)](https://chatluna.chat/) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ChatLunaLab/chatluna)

**项目状态：1.0 正式版（缓慢开发，准备 v2 版本）**

</div>

## 📸 截图

| 预设 | Agent 模式 & 流式输出 | 图像渲染输出 |
|---------------------|--------------------------|--------------------|
|![preset](https://s2.loli.net/2024/10/17/hfyoKXtJC5dV2Lg.webp) | ![plugin](https://s2.loli.net/2024/10/17/pcDjSIVMkB1aO6L.webp) | ![code](https://s2.loli.net/2024/10/17/7TBlbDsPM95iwdr.gif)|

## ✨ 特性

* 🚀 高度可扩展（基于 LangChain 和 Koishi API）
* 🎭 自定义对话预设
* 🛡️ 速率限制和黑名单系统
* 🎨 多格式输出（文本、语音、图像、混合）
* 🧠 上下文感知和 [长期记忆](./packages/extension-long-memory/README.md)
* 🔀 三种模式：聊天、浏览、Agent
* 🔒 内容审核（通过 [Koishi 审核服务](https://censor.koishi.chat/)）

## 📝 TODO (画饼是吧)

* [x] 基于房间的对话系统
* [x] 回复内容审核 （基于其他插件提供的 censor 服务）
* [x] 语音输出支持（即文字转语音，基于 initialencounter
  佬的 [vits服务](https://github.com/initialencounter/2022-12-24/blob/neat/plugins/Tool/vits/readme.md)）
* [x] 图片渲染回复
* [x] 接入更多模型/平台
* [x] 预设系统
* [x] ~~导入或导出会话记录（实际未完成，已放弃支持）~~
* [x] 重构到 v1 版本
* [x] 流式响应支持
* [x] 图片多模态输入支持
* [x] [MCP 协议客户端支持](./packages/extension-mcp/README.md)
* [x] i18n 本地化支持

## 🚀 部署

在 Koishi 下可直接安装本插件，而无需额外编辑配置文件。

阅读 [此文档](https://chatluna.chat/guide/getting-started.html) 了解更多。

## 🔌 适配支持

我们目前支持以下模型/平台：

| 模型/平台                                                | 接入方式                   | 特性                                           |
|:-----------------------------------------------------|:-----------------------|----------------------------------------------|
| [OpenAI](./packages/adapter-openai/README.md)        | 本地 Client，官方 API 接入    | 可自定义人格，支持 Agent/浏览模式等聊天模式                        |
| [Azure OpenAI](./packages/adapter-azure-openai/README.md) | 本地 Client，官方 API 接入    | 可自定义人格，支持 Agent/浏览模式等聊天模式                        |
| [Google Gemini](./packages/adapter-gemini/README.md)     | 本地 Client，官方 API 接入    | 速度快，性能超越 GPT-3.5                             |
| [Claude API](./packages/adapter-claude/README.md)                 | 本地 Client, 官方 API 接入    | 超大上下文，大部分情况下能超过 GPT 3.5，需要 API KEY，收费        |
| [Deepseek](./packages/adapter-deepseek/README.md) |   本地 Client，官方 API 接入    | 国产知名模型   |
| [通义千问](./packages/adapter-qwen/README.md)          | 本地 Client，官方 API 接入    | 阿里出品国产模型，有开源版本，有免费额度            |
| [豆包](./packages/adapter-doubao/README.md) | 本地 Client，官方 API 接入    | 字节出品模型，送免费额度                               |
| [智谱](./packages/adapter-zhipu/README.md)             | 本地 Client，官方 API 接入    | ChatGLM，新人注册可获取免费 Token 额度                   |
| [讯飞星火](./packages/adapter-spark/README.md)           | 本地 Client，官方 API 接入    | 国产模型，新人注册可获取免费 Token 额度                      |
| [文心一言](./packages/adapter-wenxin/README.md)          | 本地 Client，官方 API 接入    | 百度出品系列模型                                |
| [混元大模型](./packages/adapter-hunyuan/README.md)          | 本地 Client，官方 API 接入    | 腾讯出品系列大模型                              |
| [Ollama](./packages/adapter-ollama/README.md)            | 本地 Client，自搭建 API 接入   | 知名开源模型合集，支持 CPU / GPU 混合部署，可本地搭建                                 |
| [RWKV](./packages/adapter-rwkv/README.md)            | 本地 Client，自搭建 API 接入   | 知名开源模型，可本地搭建                                 |

[为模型提供网络搜索能力](./packages/service-search/README.md) 我们支持：

* Google (API)
* Bing (API / Web)
* DuckDuckGO (Lite)
* Tavily (API)

## 🎭 预设

从 `1.0.0-alpha.10` 版本开始，我们使用更加可定制化的预设。新的人格预设使用 yaml 做为配置文件。

你可以点这里来查看我们默认附带的人格文件：[catgirl.yml](./packages/core/resources/presets/catgirl.yml)

我们默认的预设文件夹路径为 `你当前运行插件的 koishi 目录的路径+/data/chathub/presets` 。

所有的预设文件都是从上面的文件夹上加载的。因此你可以自由添加和编辑预设文件在这个文件夹下，然后使用命令来切换人格预设。

如需了解更多，可查看[此文档](https://chatluna.chat/guide/preset-system/introduction.html)。

## 🔧 Fork & Develop

在任意 Koishi 模版项目上运行下列指令来克隆 ChatLuna：

```bash
# yarn
yarn clone ChatLunaLab/chatluna
# npm
npm run clone ChatLunaLab/chatluna
```

可将上面 `ChatLunaLab/chatluna` 替换成你自己 Fork 后的项目地址。

编辑模版项目根目录下的 `tsconfig.json` 文件，在 `compilerOptions.paths` 中添加 ChatLuna 项目路径。

```json
{
  "extends": "./tsconfig.base",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "koishi-plugin-chatluna-*": ["external/chatluna/packages/*/src"]
    }
  }
}
```

由于项目本身比较复杂，初始使用必须构建一次。

```bash
# yarn
yarn workspace @root/chatluna-koishi build
# npm
npm run build -w @root/chatluna-koishi
```

完成！现在即可在根项目中使用 `yarn dev` 或 `npm run dev` 启动模版项目并二次开发 ChatLuna。

> 虽然 Koishi 支持模块热替换(hmr)，但本项目可能并未完全兼容。
>
> 如果你在使用 hmr 二次开发本项目时出现了 Bug，请在 Issue 中提出，并按上面步骤重新构建项目并重启 Koishi 以尝试修复。

## 🆘 Help

目前 ChatLuna 项目组产能极为稀缺，没有更多产能来完成下面的目标：

* [ ] Web UI
* [ ] Http Server
* [x] Project Documentation

欢迎提交 Pull Request 或进行讨论，我们非常欢迎您的贡献！

## 👥 贡献者名单

<a href="https://github.com/ChatLunaLab/chatluna/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLunaLab/chatluna" />
</a>

![Alt](https://repobeats.axiom.co/api/embed/d92b5a9398ee02a797355ed9b866aa93231c25b3.svg "Repobeats analytics image")

<a href="https://www.star-history.com/#ChatLunaLab/chatluna&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ChatLunaLab/chatluna&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ChatLunaLab/chatluna&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ChatLunaLab/chatluna&type=Date" />
 </picture>
</a>

## 📢 使用须知

本项目由[ChatLunaLab](https://github.com/ChatLunaLab) 开发。

ChatLuna（下称本项目）
是一个基于大型语言模型的对话机器人框架。我们致力于与开源社区合作，推动大模型技术的发展。我们强烈呼吁开发者和其他使用者遵守开源协议，确保不将本项目（以及社区推动的基于本项目的其他衍生产品）的框架和代码以及相关衍生物用于可能对国家和社会造成危害的任何目的，以及未经过安全评估和备案的服务。

本项目不直接提供任何生成式人工智能服务的支持，需要使用者自行从提供了生产式人工智能服务的组织或个人获取使用的算法 API。

如果您使用了本项目，请您遵循当地地区的法律法规，使用在当地地区内可用的生产式人工智能服务算法。

本项目不对算法生成的结果负责，所有结果和操作均由使用者自行负责。

本项目的相关信息存储均由用户自行配置来源，项目本身不提供直接的信息存储。

本项目不承担使用者导致的数据安全、舆情风险或发生任何模型被误导、滥用、传播、不当利用而产生的风险和责任。

## 🙏 致谢

[Koishi](https://github.com/koishijs/koishi) - 跨平台、可扩展、高性能的 NodeJS 聊天机器人框架。

[AstrBot](https://github.com/AstrBotDevs/AstrBot) - 一站式 Agentic 个人和群聊助手的 Python 框架，多平台部署机器人。

本项目在编写时也参考了其他的开源项目，特别感谢以下项目：

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[chathub](https://github.com/chathub-dev/chathub)
