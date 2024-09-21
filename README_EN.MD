<div align="center">

<img src="./logo.png" alt="Project Icon" title="Project Icon" />

Chinese | [English](./README_EN.MD)

#

_A multi-platform model access, extensible, multi-output format, providing large language model chat service bot plugin._

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna/next)](https://www.npmjs.com/package/koishi-plugin-chatluna) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna)](https://www.npmjs.com/package/koishi-plugin-chatluna) ![node version](https://img.shields.io/badge/node-%3E=18-green) ![github top language](https://img.shields.io/github/languages/top/ChatLunaLab/chatluna?logo=github)

[![Telegram](https://img.shields.io/badge/Join-Telegram_Group-blue)](https://t.me/koishi_chatluna) [![QQ](https://img.shields.io/badge/Join-QQ_Group-ff69b4)](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=eEBVq6GK7HYX2y61x55WD6hnXTIRop-0&authKey=i4pG5%2BJ%2FY8auWprBubhremTkn3vroPigQq5m9RENGBLrLmlj%2BSu3G%2BqllK7Wts2M&noverify=0&group_code=282381753) [![doc](https://img.shields.io/badge/See-Document(WIP)-green)](https://chatluna.chat/)

**Project Status: Slowly iterating to version 1.0 (Urgently need manpower to complete the documentation)**

</div>

## Screenshots

Under construction.....

## Features

- High extensibility, based on LangChain and Koishi, we provide a set of extension APIs that allow third-party plugin developers to easily extend or call the services of this project, such as calling models, connecting new models, etc.
- Preset system, can set conversation presets, and train models.
- Blacklist system, global cooldown time and model concurrent request limit, as well as hourly model call quota limit, easy management of model call quotas, etc.
- Supports rendering model replies in voice/text/image/mixed formats, and also supports parsing returned markdown to naturally split into multiple messages for sending.
- Contextual conversation, long-term memory support (requires adapter support)
- Three chat modes: `chat`, `browsing`, `plugin`

  The latter two modes allow the model to call external tools, enabling the model to obtain external information and perform related operations.

- Content safety filtering, based on Koishi's [censor service](`https://censor.koishi.chat/`), to prevent the model from returning inappropriate content.

## TODO

- [x] Room-based conversation system
- [x] Reply content review (based on censor services provided by other plugins)
- [x] Voice output support (i.e., text-to-speech, based on initialencounter's [vits service](https://github.com/initialencounter/mykoishi/blame/master/vits/readme.md))
- [x] Image rendering replies
- [x] Integrate more models/platforms
- [x] Preset system
- [x] ~~Import or export conversation records (actually not completed, support abandoned)~~
- [x] Refactor to version 1
- [x] Stream response support
- [x] ~~i18n localization support~~

## Deployment

We can directly install this plugin under Koishi to use without additional configuration.

Read [this document](https://chatluna.chat/guide/getting-started.html) to learn more.

## Adapters

We currently support the following models/platforms:

| Model/Platform                                                | Access Method                   | Features                                           | Notes                                  |
|:-----------------------------------------------------|:-----------------------|----------------------------------------------|:--------------------------------------|
| [OpenAI](./packages/openai-adapter/README.md)        | Local Client, official API access    | Customizable personality, supports chat modes such as plugin/browsing                        | API access requires payment                            |
| [Azure OpenAI](./packages/azure-openai-adapter/README.md) | Local Client, official API access    | Customizable personality, supports chat modes such as plugin/browsing                        | API access requires payment                            |
| [Google Gemini](./packages/gemini-adapter/README.md) | Local Client, official API access    | Fast speed, performance surpasses GPT-3.5                             | Requires a Gemini access account, may charge                |
| [New Bing](./packages/newbing-adapter/README.md)     | Local Client, reverse API access    | Built-in web search, strong timeliness, can be used without login                          | Requires proxy, needs to pass captcha (can be used without Cookie)                        |
| [Claude API](./packages/claude-adapter)              | Local Client, official API access    | Large context, mostly exceeds GPT 3.5, requires API KEY, charges        | May be expensive, does not support Function Call                |
| [Zhipu](./packages/zhipu-adapter/README.md)             | Local Client, official API access    | ChatGLM, new users can get free Token quota                   | Actual effect is slightly better than iFlytek Spark                           |
| [Qwen](./packages/qwen-adapter/README.md)            | Local Client, official API access    | Alibaba's domestic model, has free quota                               | Actual effect is about equal to iFlytek Spark                          |
| [iFlytek Spark](./packages/spark-adapter/README.md)           | Local Client, official API access    | Domestic model, new users can get free Token quota                      | Actual effect is about equal to GPT 3.5                       |
| [Wenxin Yiyan](./packages/wenxin-adapter/README.md)          | Local Client, official API access    | Baidu's classic model                                | Actual effect is about equal to Qwen                           |
| [Ollama](./packages/ollama-adapter/README.md)            | Local Client, self-built API access   | Well-known open-source model collection, supports CPU / GPU hybrid deployment, can be self-built                                 | Requires self-built backend API, requires certain configuration                  |
| [GPT Free](./packages/gptfree-adapter/README.md)     | Local Client, official API access    | Local forwarding using other websites' GPT models, project automatically configures website and other settings, no manual registration required        | May fail at any time, unstable                            |
| [ChatGLM](./packages/chatglm-adapter/README.md)      | Local Client, self-built backend API access | Can be self-built, almost free                                | Requires self-built backend API, requires certain configuration, model parameters are not large enough to achieve good chat effects |
| [RWKV](./packages/rwkv-adapter/README.md)            | Local Client, self-built API access   | Well-known open-source model, can be self-built                                 | Requires self-built backend API, requires certain configuration                  |

[Providing network search capabilities for models](/packages/search-service/README.md) We support:

- Google (API)
- Bing (API)
- DuckDuckGO (Lite & Web)

## Preset

Starting from version `1.0.0-alpha.10`, we use more customizable presets. New personality presets use yaml as configuration files.

You can click here to view our default personality file: [catgirl.yml](/packages/core/resources/presets/catgirl.yml)

Our default preset folder path is `the path of your current running plugin's koishi directory+/data/chathub/presets`.

All preset files are loaded from the above folder. Therefore, you can freely add and edit preset files under this folder, and then use commands to switch personality presets.

For more information, see [this document](https://chatluna.chat/guide/preset-system/introduction.html).

## Fork & Develop

Run the following command on any Koishi template project to clone ChatLuna:

```bash
# yarn
yarn clone ChatLunaLab/chatluna
# npm
npm run clone ChatLunaLab/chatluna
```

You can replace the above `ChatLunaLab/chatluna-koishi` with your own forked project address.

Then edit the `tsconfig.json` file in the root directory of the template project, and add the ChatLuna project path in `compilerOptions.paths`.

``` json
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

Since the project itself is relatively complex, it must be built once initially.

``` bash
# yarn
yarn workspace @root/chatluna-koishi build
# npm
npm run build -w @root/chatluna-koishi
```

Done! Now you can use `yarn dev` or `npm run dev` in the root project to start the template project and develop ChatLuna.

> Although Koishi supports module hot replacement (hmr), this project may not be fully compatible.
>
> If you encounter bugs when using hmr to develop this project, please raise an issue and follow the above steps to rebuild the project and restart Koishi to try to fix it.

## Help

Currently, the ChatLuna project team is extremely short of production capacity and has no more capacity to complete the following goals:

- [ ] Web UI
- [ ] Http Server
- [ ] Project Documentation

Welcome to submit Pull Requests or discuss, we welcome your contributions!

## Contributors

<a href="https://github.com/ChatLunaLab/chatluna/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLunaLab/chatluna" />
</a>

![Alt](https://repobeats.axiom.co/api/embed/6996e228e38a44a28ed2629b667ef87a729f12ae.svg "Repobeats analytics image")

[![Star History Chart](https://api.star-history.com/svg?repos=ChatLunaLab/chatluna&type=Date)](https://star-history.com/#ChatLunaLab/chatluna)

## Usage Notice

This project is developed by [ChatLunaLab](https://github.com/ChatLunaLab).

ChatLuna (hereinafter referred to as this project)
is a chatbot framework based on large language models. We are committed to cooperating with the open-source community to promote the development of large model technology. We strongly urge developers and other users to comply with open-source agreements to ensure that this project (and other derivative products based on this project promoted by the community) is not used for any purposes that may harm the country and society, as well as services that have not been evaluated and filed for safety.

This project does not directly provide any support for generative artificial intelligence services, and users need to obtain the algorithms API used from organizations or individuals that provide generative artificial intelligence services.

If you use this project, please follow the laws and regulations of your local area and use the generative artificial intelligence service algorithms available in your local area.

This project is not responsible for the results generated by the algorithm, and all results and operations are the responsibility of the user.

The relevant information storage of this project is configured by the user, and the project itself does not provide direct information storage.

This project is not responsible for data security, public opinion risks, or any risks and responsibilities arising from model misguidance, abuse, dissemination, and improper use caused by users.

## Thanks

This project also refers to other open-source projects during its writing, especially thanks to the following projects:

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[node-chatgpt-api](https://github.com/waylaidwanderer/node-chatgpt-api)

[poe-api](https://github.com/ading2210/poe-api)

[Bard](https://github.com/muhiris/wgpt)

[chathub](https://github.com/chathub-dev/chathub)

Special thanks to [JetBrains](https://www.jetbrains.com/?from=ChatLuna)
for providing free open-source licenses for IDEs such as [WebStorm](https://www.jetbrains.com/webstorm/?from=ChatLuna) for this project.

[<img src=".github/jetbrains-variant-3.png" width="200"/>](https://www.jetbrains.com/?from=ChatLuna)
