# koishi-plugin-chatluna-agent

ChatLuna Agent 框架，提供 MCP、Skills、Scheduler、Tool 和 Sub-Agent 支持。

## 功能

- **MCP**: Model Context Protocol 支持
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

配置文件位于 `data/chatluna/agent/config.json`。

## License

AGPL-3.0
