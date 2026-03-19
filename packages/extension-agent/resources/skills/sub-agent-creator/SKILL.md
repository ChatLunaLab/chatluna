---
name: sub-agent-creator
description: Create, edit, convert, or audit ChatLuna sub-agent markdown files. Use when adding a new sub-agent, refining a sub-agent prompt, choosing a sub-agent's goal and output contract, restricting tools, skills, MCP, or computer permissions, pinning or omitting a model, setting maxTurns, placing agents under local `data/chatluna/agents`, writing them into a remote sandbox before `agentcli sync`, or converting Claude or OpenCode agent files into ChatLuna-compatible sub-agents.
---

# Sub-Agent Creator

Create complete sub-agent markdown files for ChatLuna's `extension-agent` package.
Prefer ChatLuna format unless the target file, target directory, or user request
clearly calls for Claude or OpenCode compatibility.

## Default Decisions

- Default new ChatLuna-native agents to
  local `data/chatluna/agents/<agent-name>/index.md`.
- If the current computer backend is not `local`, write the new file to the
  sandbox path `~/.chatluna/agents/<agent-name>/index.md` instead, create the
  parent folder first if it does not exist, and finish with `agentcli sync
subagents` so the local ChatLuna path is updated.
- Preserve the existing format when editing an existing sub-agent file.
- Use a short, specific agent name. Keep the job narrow.
- Omit `model` when you do not know the exact installed model name. Let the
  sub-agent inherit the parent model instead of guessing.
- Keep `allowKoishiMessageTransform: false` unless the agent must receive the
  user's Koishi message structure instead of plain text.

## Authoring Workflow

1. Define the agent's exact job.
    - State the goal, the expected input, the limits, and the expected final
      answer.
    - Split planning, implementation, review, and UI control into separate
      agents when possible.

2. Choose the narrowest permission set that still works.
    - Read-only agents usually need `file_read`, `glob`, and `grep`.
    - Focused coding agents usually need `file_read`, `file_edit`, `file_write`,
      `glob`, `grep`, and sometimes `bash`.
    - Web research agents may need `web_search` and `web_browser`.
    - Keep computer access denied unless the task truly needs desktop control.

3. Choose model and turn budget.
    - Use the exact requested model when the user provides one.
    - Leave `model` unset when the correct model is unknown.
    - Use `8-20` turns for lookup or review, `20-60` for focused
      implementation, and `100` only for broad multi-step work.

4. Write the prompt body.
    - Start with the role in one sentence.
    - Name the tools or capabilities the agent can rely on.
    - Describe the workflow in execution order.
    - State hard boundaries.
    - End with the required result format.

5. Review the file.
    - Remove placeholders, TODOs, and vague filler.
    - Make sure the description says when the parent should use this agent.
    - Make sure the permissions match the prompt.
    - If the file was authored in a sandbox, run `agentcli sync subagents` and
      verify the local file path after sync.

## What Good Sub-Agents Look Like

- Make the `description` usable as catalog text. Write what the agent does and
  when to call it.
- Make the prompt operational, not inspirational. Tell the agent what to do
  first, what to avoid, and what to return.
- Keep each agent single-purpose. Do not create a giant all-in-one assistant.
- Prefer explicit output contracts such as file paths, line numbers, patches,
  checklists, or concise result summaries.
- Do not rely on nested delegation. The platform blocks sub-agents from using
  `task`.

## ChatLuna Format

Use this format for new ChatLuna-native agents.

```md
---
name: explore-api
description: Read-only API exploration agent. Use when you need to find routes, trace handlers, inspect request or response shapes, and report exact files and line numbers.
format: chatluna
enabled: true
hidden: false
model: openai/gpt-4.1-mini
maxTurns: 12
allowKoishiMessageTransform: false
permissions:
    skills:
        mode: deny
        allow: []
        deny: []
    mcp:
        mode: allow
        allow: []
        deny: []
    tools:
        mode: allow
        allow:
            - file_read
            - glob
            - grep
        deny: []
    computer:
        mode: deny
        allow: []
        deny: []
---

You are the Explore API sub-agent. Your job is to inspect the codebase and answer API questions with evidence.

Start with broad discovery using glob and grep. Then read only the files that matter and trace imports or call sites until the path from route entry to handler is clear.

Do not edit files, run shell commands, use MCP, or speculate beyond the code you can point to.

Return:

- the relevant endpoints or entry points
- the exact files and line numbers
- the request and response shape when present
- any uncertainty that still needs a human decision
```

## ChatLuna Frontmatter Fields

- `name`: Human-facing sub-agent name.
- `description`: Catalog text. Include both capability and trigger.
- `format`: Use `chatluna` for native agents.
- `enabled`: Usually `true`.
- `hidden`: Set `true` only when the agent should stay out of the normal
  catalog.
- `model`: Optional exact model name. Omit to inherit from the parent agent.
- `maxTurns`: Hard turn budget. Default config is `100`, but most specialists
  should use less.
- `allowKoishiMessageTransform`: Set `true` only when the prompt must preserve
  Koishi message elements, mentions, or multimodal transforms.
- `permissions`: Four permission groups: `skills`, `mcp`, `tools`, and
  `computer`.

## Permission Rules

Each permission group uses this shape:

```yaml
mode: inherit | all | allow | deny
allow: []
deny: []
```

- `inherit`: Use the global default for that category.
- `all`: Allow everything in that category.
- `allow`: Allow only the listed entries.
- `deny`: Deny the listed entries and allow the rest of that category.

Prefer `mode: allow` for tight specialist agents. It is the clearest and safest
way to restrict behavior.

Use the right names:

- `permissions.tools`: Tool names such as `file_read`, `file_edit`,
  `file_write`, `glob`, `grep`, `bash`, `web_search`, `web_browser`.
- `permissions.skills`: Skill names.
- `permissions.mcp`: MCP server names.
- `permissions.computer`: Backend names such as `local`, `e2b`, and
  `open-terminal`.

Important behavior:

- Sub-agents cannot use `task`, even if you mention it.
- Only the builtin `plan` and `explore` agents get hard-coded read-only
  protection. Custom read-only agents must restrict their own tools.
- When you want "no MCP", use `mcp.mode: allow` with an empty `allow` list.
- When you want "no tools", use `tools.mode: allow` with an empty `allow`
  list.

## Recommended Permission Shapes

Use these patterns as defaults.

### Read-only explorer

```yaml
permissions:
    skills:
        mode: deny
        allow: []
        deny: []
    mcp:
        mode: allow
        allow: []
        deny: []
    tools:
        mode: allow
        allow: [file_read, glob, grep]
        deny: []
    computer:
        mode: deny
        allow: []
        deny: []
```

### Focused coder with shell access

```yaml
permissions:
    skills:
        mode: deny
        allow: []
        deny: []
    mcp:
        mode: allow
        allow: []
        deny: []
    tools:
        mode: allow
        allow: [file_read, file_edit, file_write, glob, grep, bash]
        deny: []
    computer:
        mode: deny
        allow: []
        deny: []
```

### Browser or desktop operator

```yaml
permissions:
    skills:
        mode: deny
        allow: []
        deny: []
    mcp:
        mode: allow
        allow: []
        deny: []
    tools:
        mode: allow
        allow: [web_search, web_browser]
        deny: []
    computer:
        mode: allow
        allow: [local]
        deny: []
```

Only grant `computer` when the task explicitly needs GUI or browser control.

## Claude-Compatible Format

Use Claude-style frontmatter only when editing a Claude agent or when the file
will live in a Claude agents directory.

Supported Claude fields:

- `name`
- `description`
- `model`
- `maxTurns`
- `hidden`
- `tools`
- `disallowedTools`
- `skills`
- `mcpServers`

Use a simple allow list when possible.

```md
---
name: repo-reviewer
description: Read-only review agent. Use when you need to inspect code, trace behavior, and report issues with evidence.
model: openai/gpt-4.1-mini
maxTurns: 16
hidden: false
tools:
    - read
    - glob
    - grep
skills: []
mcpServers: []
---

You are the Repo Reviewer sub-agent. Read the relevant code, gather evidence, and return precise findings with file paths and line numbers.
```

Notes:

- `read`, `write`, `edit`, `bash`, `glob`, `grep`, `webfetch`, and `task`
  aliases are mapped into ChatLuna-compatible tool names.
- Prefer `tools` over `disallowedTools` for narrow agents.

## OpenCode-Compatible Format

Use OpenCode-style frontmatter only when editing an OpenCode agent or when the
file will live in an OpenCode agents directory.

Supported OpenCode fields:

- `name`
- `description`
- `model`
- `hidden`
- `disable`
- `prompt`
- `tools`
- `permission`
- `mode`

Example:

```md
---
name: quick-explorer
description: Fast read-only explorer. Use when you need to search a repo, inspect files, and return exact evidence.
mode: subagent
model: openai/gpt-4.1-mini
hidden: false
disable: false
tools:
    read: true
    glob: true
    grep: true
    write: false
    edit: false
    bash: false
permission:
    edit: deny
    bash: deny
    webfetch: deny
    task: deny
---

You are the Quick Explorer sub-agent. Find the relevant files, read only what matters, and return exact evidence.
```

Notes:

- If `prompt` exists in frontmatter, ChatLuna prepends it to the markdown body.
- `mode` is informational here. Keep it accurate, but do not rely on it for
  enforcement.

## Prompt Writing Rules

- Tell the sub-agent what success looks like.
- Tell it what to do first.
- Tell it what not to do.
- Tell it what format to return.
- Name concrete artifacts such as file paths, symbols, routes, schemas, or test
  commands.
- Avoid generic lines such as "be helpful", "think step by step", or
  "use your best judgment" unless they add a real constraint.

## Final Checklist

- Use the correct format for the target directory or existing file.
- Match the agent name, file name, and job.
- Make the description specific enough to trigger the right agent.
- Omit `model` instead of inventing one.
- Use the narrowest permission set that still works.
- Keep `computer` off unless the task explicitly needs it.
- Keep the prompt complete. Do not leave stubs.
