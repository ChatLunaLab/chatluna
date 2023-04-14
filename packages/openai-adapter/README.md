## koishi-plugin-chathub-openai-adapter

为chathub提供OpenAI GPT-3/GPT3.5支持的适配器

## 怎么使用？

1. 请先获取你的OpenAI API Key，怎么获取这里不再赘述
2. 在插件市场安装本插件，并安装好本插件依赖的前置插件
3. 在插件配置中填写你的API Key（请求设置 -> apiKey）
4. 现在你可以尝试回复Bot一句你好，如果Bot响应了你，那么恭喜你，你已经成功接入了OpenAI。

## 常见问题

### 国内环境怎么使用？

你可以在koishi的全局设置里设置代理。当然我们更推荐你设置反代（请求设置 -> apiEndPoint）。这样本地就不需要开代理。

### 我该选择什么对话模型？

我不推荐修改默认设置，只需要选择GPT3.5 Trubo即可。GPT3.5 价格更便宜，并且对chat场景做了优化。