## koishi-plugin-chatluna-search-service

## [![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-search-service)](https://www.npmjs.com/package/koishi-plugin-chatluna-search-service) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna-search-service)](https://www.npmjs.com/package//koishi-plugin-chatluna-search-service)

> ChatLuna 的网络搜索服务插件，支持多源聚合搜索，包括 `Bing` | `Google` | `DuckDuckGo` | `Serper` | `Tavily` | `MediaWiki`

[联网查询插件文档](https://chatluna.chat/ecosystem/plugin/search-service.html)

### Parallel (MCP)

在搜索引擎（`searchEngine`）中选择 `parallel` 启用，移除该选项即可关闭。启用后，ChatLuna 可以在对话中自动搜索，并将搜索词发送到 `https://mcp.parallel.ai/mcp`。此连接无需账号或 API 密钥，免费请求有速率限制。请求中的 User-Agent 包含插件名称和版本，方便 Parallel 统计免费 MCP 的总体用量。

Select **Parallel (MCP)** in Search Engine (`searchEngine`) to enable it, and remove it to turn it off. When enabled, ChatLuna can automatically send search queries to `https://mcp.parallel.ai/mcp` during chats. No account or API key is required. Free requests are rate limited. The User-Agent includes the plugin name and version so Parallel can measure aggregate free MCP usage.
