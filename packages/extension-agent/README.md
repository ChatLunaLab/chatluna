# koishi-plugin-chatluna-agent

ChatLuna Agent 框架，提供 MCP、Skills、Scheduler、Tool 和 Sub-Agent 支持。

## 功能

- **MCP**: Model Context Protocol 支持
- **MCP 目录懒加载**: 通过稳定的 `search_mcp_tools` 和
  `invoke_mcp_tool` 按需检索契约并调用真实工具。搜索先返回精简摘要，
  选定工具后再单独加载完整 Schema。
- **Skills**: 技能管理（规划中）
- **Scheduler**: 任务调度（规划中）
- **Tool**: 工具管理（规划中）
- **Sub-Agent**: 子代理（规划中）

## 使用

安装插件后，通过 `ctx.chatluna_agent` 访问服务：

```ts
ctx.chatluna_agent.mcp.getStatus()
ctx.chatluna_agent.mcp.listTools()
```

## 配置

配置文件位于 `data/chatluna/agents/config.json`。

MCP 工具披露模式可在 WebUI 的 MCP 页面切换：`eager`（默认，暴露全部
MCP 工具）或 `catalog`（模型只会收到固定的搜索和调用网关工具，
真实 MCP 工具的契约在需要时才加载）。

## License

AGPL-3.0
