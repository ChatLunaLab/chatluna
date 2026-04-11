---
name: agent-config-admin
description: >-
    Use this for agent admin work done through the dedicated `agentcli` tool:
    inspect or change its own skills, sub-agents, tools, MCP servers, MCP
    tools, permissions, routing, or sandbox-to-local sync. Also use it when a
    task needs to create or edit a skill or sub-agent together with config
    changes, but remember that `agentcli` cannot author those files directly and
    the agent must load `skill-creator` or `sub-agent-creator` first.
---

Use this skill for any request that inspects or changes the agent's own admin
state. That includes skill enablement, sub-agent permissions, tool routing,
MCP config, and syncing sandbox-authored skills or sub-agents back to local
storage.

## Core protocol

- Do not guess config, paths, or effective permissions.
- **Use the `agentcli` tool** for commands that start with `agentcli`.
- Treat `agentcli` as a dedicated tool that accepts the same CLI syntax.
- Do not mix `agentcli` work with normal shell commands in the same tool call.
- Use `agentcli --help` or `agentcli <command> --help` when you need the exact command shape.
- Before create, update, remove, or config work on skills, sub-agents, tools, or MCP, run the full activation sweep.
- After the activation sweep, inspect the exact target with `agentcli show ...`.
- Before any config change, use `agentcli preview ...`.
- Repeated `agentcli preview ...` commands in the same session append to the same pending preview until `agentcli apply last` or `agentcli cancel pending`.
- Many named preview commands accept multiple targets in one call, including skills, sub-agents, tools, MCP tools, and removable MCP servers.
- Tool authority can be set with `agentcli preview set tool <name...> authority <0-5>`.
- Only commit a pending preview with `agentcli apply last`.
- If the user changes direction, discard the pending preview with `agentcli cancel pending`.

## Creation rules for skills and sub-agents

- `agentcli` cannot create a skill folder or a sub-agent markdown file by itself.
- When the task creates or edits a skill, you must load `skill-creator` first and follow that skill while authoring the files.
- When the task creates or edits a sub-agent markdown file, you must load `sub-agent-creator` first and follow that skill while authoring the file.
- Use `agentcli` to inspect paths, preview config, and sync sandbox-authored files. Use normal file tools or normal shell commands only for the actual file creation or editing work.
- If the current computer backend is not `local`, the sandbox may not already contain the target `skills` or `sub-agents` directory. Create the missing directory first before writing files.
- After writing skill or sub-agent files in a non-local sandbox, run `agentcli sync`, `agentcli sync skills`, or `agentcli sync subagents` so the files are staged back to the local instance paths.
- If a sync preview shows overwrites, list the local files that will be replaced and wait for explicit confirmation before `agentcli apply last`.

## Path rules

- The local skill and sub-agent paths shown by `agentcli` belong to the current instance, not to your own computer environment.
- When the backend is `local`, write directly to those local instance paths.
- When the backend is not `local`, write into the sandbox paths shown in the prompt or returned by `agentcli show overview`, then sync those files back to the local instance paths.
- Never invent a home directory or machine-specific path that was not provided by ChatLuna.

## Important rules

- The activation sweep is mandatory for create, update, remove, or config work on skills, sub-agents, tools, or MCP, even if the user named only one area.
- Prefer exact selectors like `builtin:plan` for sub-agents when possible.
- If a preview shows the wrong target, do not apply it.
- When changing permissions, always verify the result with `agentcli show subagent <selector> effective` or another matching `show` command.
- When the task authors new skill or sub-agent files, verify both the file result and the admin result before saying the task is done.
- If the `agentcli` tool is unavailable, say so instead of inventing results.

## Activation sweep

```bash
agentcli show skills
agentcli show subagents
agentcli show tools
agentcli show mcp servers
agentcli show mcp tools
```

## Common commands

```bash
agentcli --help
agentcli show overview
agentcli show skills
agentcli show skill coding-agent
agentcli show subagents
agentcli show subagent builtin:plan effective
agentcli show tools
agentcli show tool bash
agentcli show mcp servers
agentcli show mcp server filesystem
agentcli show mcp tools
agentcli show pending
agentcli sync
agentcli sync skills
agentcli sync subagents
```

```bash
agentcli preview enable skill coding-agent onboard delight
agentcli preview enable skill coding-agent
agentcli preview disable tool bash file_edit file_write --main
agentcli preview disable tool bash --main && agentcli preview disable tool file_edit file_write --main
agentcli preview disable subagent builtin:plan
agentcli preview set subagent builtin:plan builtin:general tools allow file_read glob grep
agentcli preview set subagent builtin:plan tools allow file_read glob grep
agentcli preview set tool bash grep authority 3
agentcli preview set tool bash grep subagents allow builtin:general
agentcli preview set mcp tool filesystem_read filesystem_write enabled false
agentcli preview remove mcp server filesystem browser
agentcli preview save mcp server filesystem json '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}'
agentcli preview remove mcp server filesystem
agentcli apply last
agentcli cancel pending
```

## Workflow

1. Run the activation sweep for create, update, remove, or config work.
2. Run `agentcli show overview` and inspect the exact target with `agentcli show ...`.
3. If the task creates or edits a skill or sub-agent file, load `skill-creator` or `sub-agent-creator` first.
4. If the backend is not `local`, make sure the sandbox `skills` or `sub-agents` directory exists before writing files.
5. Author the skill or sub-agent files in the correct local or sandbox directory.
6. For config changes, create one focused preview with `agentcli preview ...` and append more `preview` calls if the task needs multiple staged changes.
7. For sandbox-authored files, run `agentcli sync` to create a preview for the local write-back.
8. Check the preview carefully. If it overwrites local files, get the user's confirmation before applying it.
9. Apply with `agentcli apply last`.
10. Read back the affected config, effective permissions, or synced local files.

## Command chaining

- `agentcli` command lines may contain `&`, `&&`, `|`, `|&`, `||`, and `;`.
- Treat `|` and `|&` as command separators for multiple `agentcli` calls on one line. They do not provide stdin piping between `agentcli` tool commands.
- Named preview commands accept multiple targets when the syntax uses `<name...>` or `<selector...>`.
- `agentcli preview enable tool` and `agentcli preview disable tool` accept multiple tool names before `--main`.
- `agentcli preview set tool <name...> authority <0-5>` updates required Koishi authority for one or more tools.
