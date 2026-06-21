---
name: agentcli
description: >-
    Use this skill to inspect or change ChatLuna agent admin state — skills,
    sub-agents, tools, MCP servers, MCP tools, or permission rules. The skill
    edits a working copy of the agent config inside the sandbox; the user must
    run `chatluna.agent sync` to write changes back to the host instance.
---

This skill ships a CLI that runs inside the sandbox via the bash tool. It
reads and writes a working copy of the agent config materialized next to the
script (`config.json` in this skill folder). Local edits do **not** take
effect until the user runs `chatluna.agent.sync` on the host instance.

## How to invoke

Run the script through the bash tool:

```bash
node "<skill-dir>/bin/agentcli.cjs" <command> [args...]
```

`<skill-dir>` is the location reported in the skill prompt (or by
`agentcli.cjs --skill-dir`). Always quote paths.

## Read commands

```bash
node bin/agentcli.cjs show overview
node bin/agentcli.cjs show skills
node bin/agentcli.cjs show skill <name|id>
node bin/agentcli.cjs show subagents
node bin/agentcli.cjs show subagent <selector>
node bin/agentcli.cjs show tools
node bin/agentcli.cjs show tool <name>
node bin/agentcli.cjs show mcp servers
node bin/agentcli.cjs show mcp server <name>
node bin/agentcli.cjs show mcp tools
node bin/agentcli.cjs show mcp tool <name>
```

## Write commands

```bash
# skills
node bin/agentcli.cjs enable skill <name|id...>
node bin/agentcli.cjs disable skill <name|id...>
node bin/agentcli.cjs remove skill <name|id...>

# sub-agents
node bin/agentcli.cjs enable subagent <selector...>
node bin/agentcli.cjs disable subagent <selector...>
node bin/agentcli.cjs remove subagent <selector...>
node bin/agentcli.cjs set subagent <selector...> <tools|skills|mcp|computer> <all|allow|deny|inherit> [items...]

# tools
node bin/agentcli.cjs enable tool <name...> [--main]
node bin/agentcli.cjs disable tool <name...> [--main]
node bin/agentcli.cjs set tool <name...> <enabled|main|chatluna|character|group|private|authority|subagents> <value> [items...]

# mcp
node bin/agentcli.cjs set mcp tool <name...> enabled <bool>
node bin/agentcli.cjs save mcp server <name> json '<json>'
node bin/agentcli.cjs remove mcp server <name...>
```

Each write rewrites `config.json` in place and keeps a `config.json.bak`.

## Workflow

1. Run `node bin/agentcli.cjs show overview` to understand the current state.
2. For each change, run the matching write command. Verify with another
   `show ...` after the edit.
3. When the edits are ready, ask the user to run `chatluna.agent sync`. That
   validates the working copy and atomically replaces the live config.
4. Authoring new skill or sub-agent files still requires loading
   `skill-creator` or `sub-agent-creator` first. Place those files under the
   sandbox skill / sub-agent directories shown by `show overview`. The same
   `chatluna.agent sync` command flushes them back to the host.
5. Never invent paths. Read the directories from `show overview`.

## Notes

- This script does **not** load the live ChatLuna service. `show` output is
  derived from the working copy of `config.json` plus a scan of the sandbox
  skill / sub-agent directories. Treat it as authoritative for config; for
  runtime state, the host `chatluna.agent` console remains the source of
  truth.
- Removing a skill or sub-agent here only removes its config entry. To erase
  the actual files, delete them from the corresponding sandbox directory
  before running `chatluna.agent.sync`.
- If the bash tool is unavailable, say so instead of guessing.
