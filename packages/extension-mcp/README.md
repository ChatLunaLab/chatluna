## koishi-plugin-chatluna-mcp-client

## [![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-mcp-client)](https://www.npmjs.com/package/koishi-plugin-chatluna-mcp-client) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna-mcp-client)](https://www.npmjs.com/package//koishi-plugin-chatluna-mcp-client)

> 提供 MCP 协议客户端支持的插件

[MCP 协议文档](https://chatluna.chat/ecosystem/plugin/mcp-client.html)

## 代理支持 / Proxy Support

从 v1.3.0-alpha.14 开始，远程 MCP 服务器支持使用代理。您可以在每个 MCP 服务器配置中添加可选的 `proxyAddress` 字段。

Starting from v1.3.0-alpha.14, remote MCP servers support using proxies. You can add an optional `proxyAddress` field to each MCP server configuration.

### 支持的协议 / Supported Protocols

- HTTP: `http://proxy.example.com:8080`
- HTTPS: `https://proxy.example.com:8080`
- SOCKS4/5: `socks://proxy.example.com:1080`, `socks5://proxy.example.com:1080`

### 配置示例 / Configuration Example

```json
{
  "mcpServers": {
    "example-server": {
      "url": "https://mcp-server.example.com",
      "type": "streamable_http",
      "proxyAddress": "http://localhost:7890"
    }
  }
}
```
