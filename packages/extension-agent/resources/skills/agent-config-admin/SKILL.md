---
name: agent-config-admin
description: Inspect and change ChatLuna agent runtime config through the virtual `agentctl` CLI bridged into the bash tool. Use when managing MCP servers and tools, sub-agent availability and permissions, tool routing, or effective access rules.
allowed-tools: bash
---

Use this skill when the user wants to inspect or change ChatLuna agent config, including MCP servers, MCP tools, sub-agents, tool routing, and effective permissions.

Protocol:

- Do not answer with guessed config details.
- Use the `bash` tool and run commands that start with `agentctl`.
- Do not mix `agentctl` with normal shell commands in the same bash call.
- Read first with `agentctl show ...`.
- Before any change, use `agentctl preview ...`.
- Only commit a pending preview with `agentctl apply last`.
- If the user changes direction, discard the pending preview with `agentctl cancel pending`.

Important rules:

- Treat `agentctl` as a virtual CLI, not a real shell binary.
- Only use one `agentctl` command per bash call unless the task clearly needs a short multi-line sequence.
- If a preview shows the wrong target, do not apply it.
- Prefer exact selectors like `builtin:plan` for sub-agents when possible.
- When changing permissions, always verify the result with `agentctl show subagent <selector> effective` or another matching `show` command.

Common commands:

```bash
agentctl show overview
agentctl show skills
agentctl show skill coding-agent
agentctl show subagents
agentctl show subagent builtin:plan effective
agentctl show tools
agentctl show tool bash
agentctl show mcp servers
agentctl show mcp server filesystem
agentctl show mcp tools
agentctl show pending
```

```bash
agentctl preview enable skill coding-agent
agentctl preview disable subagent builtin:plan
agentctl preview set subagent builtin:plan tools allow file_read glob grep
agentctl preview set tool bash subagents allow builtin:general
agentctl preview set mcp tool filesystem_read enabled false
agentctl preview save mcp server filesystem json {"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}
agentctl preview remove mcp server filesystem
agentctl apply last
agentctl cancel pending
```

Workflow:

1. Inspect the current target with `show`.
2. Create one focused preview.
3. Check the preview output.
4. Apply the preview.
5. Read back the affected config or effective permissions.
