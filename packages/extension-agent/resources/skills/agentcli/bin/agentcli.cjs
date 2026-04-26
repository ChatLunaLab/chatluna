#!/usr/bin/env node
/**
 * agentcli — sandbox-side editor for the ChatLuna agent config working copy.
 *
 * Usage:
 *   node bin/agentcli.cjs <command> [args...]
 *
 * The script edits the `config.json` next to this file. All changes only
 * become live after the host runs `chatluna.agent sync`.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const SKILL_DIR = path.resolve(__dirname, '..')
const CONFIG_PATH = path.join(SKILL_DIR, 'config.json')
const BACKUP_PATH = path.join(SKILL_DIR, 'config.json.bak')

function main(argv) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
        printHelp()
        return 0
    }

    if (argv[0] === '--skill-dir') {
        process.stdout.write(SKILL_DIR + '\n')
        return 0
    }

    const cfg = loadConfig()

    try {
        const head = argv[0]
        if (head === 'show') return runShow(cfg, argv.slice(1))

        const dirty = applyMutation(cfg, argv)
        if (dirty) saveConfig(cfg)
        return 0
    } catch (err) {
        process.stderr.write(
            `error: ${err && err.message ? err.message : err}\n`
        )
        return 1
    }
}

function loadConfig() {
    let raw = '{}'
    try {
        raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    } catch (err) {
        if (err.code !== 'ENOENT') throw err
    }
    const parsed = JSON.parse(raw || '{}')
    return ensureShape(parsed)
}

function saveConfig(cfg) {
    try {
        fs.copyFileSync(CONFIG_PATH, BACKUP_PATH)
    } catch (err) {
        if (err.code !== 'ENOENT') throw err
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

function ensureShape(cfg) {
    cfg.skills = cfg.skills || {}
    cfg.skills.items = cfg.skills.items || {}
    cfg.skills.dirs = cfg.skills.dirs || []
    cfg.tool = cfg.tool || {}
    cfg.tool.items = cfg.tool.items || {}
    cfg.tool.registry = cfg.tool.registry || {}
    cfg.subAgent = cfg.subAgent || {}
    cfg.subAgent.items = cfg.subAgent.items || {}
    cfg.subAgent.builtin = cfg.subAgent.builtin || {}
    cfg.subAgent.presetAgents = cfg.subAgent.presetAgents || {}
    cfg.subAgent.defaults = cfg.subAgent.defaults || {
        skills: emptyRule('all'),
        mcp: emptyRule('all'),
        tools: emptyRule('all'),
        computer: emptyRule('all')
    }
    cfg.mcp = cfg.mcp || {}
    cfg.mcp.mcpServers = cfg.mcp.mcpServers || {}
    cfg.mcp.tools = cfg.mcp.tools || {}
    cfg.computer = cfg.computer || {}
    return cfg
}

function emptyRule(mode) {
    return { mode: mode || 'inherit', allow: [], deny: [] }
}

// ----- show -----

function runShow(cfg, args) {
    const target = args[0]
    if (!target || target === 'overview') {
        printOverview(cfg)
        return 0
    }
    if (target === 'skills') return printList('skills', listSkills(cfg))
    if (target === 'skill') return printSkill(cfg, args[1])
    if (target === 'subagents')
        return printList('subagents', listSubAgents(cfg))
    if (target === 'subagent') return printSubAgent(cfg, args[1])
    if (target === 'tools') return printList('tools', listTools(cfg))
    if (target === 'tool') return printTool(cfg, args[1])
    if (target === 'mcp' && args[1] === 'servers')
        return printList('mcp servers', Object.keys(cfg.mcp.mcpServers))
    if (target === 'mcp' && args[1] === 'server')
        return printMcpServer(cfg, args[2])
    if (target === 'mcp' && args[1] === 'tools')
        return printList('mcp tools', Object.keys(cfg.mcp.tools))
    if (target === 'mcp' && args[1] === 'tool')
        return printMcpTool(cfg, args[2])
    throw new Error(`Unknown show target: ${args.join(' ')}`)
}

function printOverview(cfg) {
    const lines = [
        'Overview',
        `  config: ${CONFIG_PATH}`,
        `  version: ${cfg.version || '(unset)'}`,
        `  skills: ${Object.keys(cfg.skills.items).length} (dirs=${cfg.skills.dirs.length})`,
        `  sub-agents: builtin=${Object.keys(cfg.subAgent.builtin).length} markdown=${Object.keys(cfg.subAgent.items).length} preset=${Object.keys(cfg.subAgent.presetAgents).length}`,
        `  tools: ${Object.keys(cfg.tool.items).length}`,
        `  mcp: servers=${Object.keys(cfg.mcp.mcpServers).length} tools=${Object.keys(cfg.mcp.tools).length}`,
        '',
        'Sandbox dirs (relative to $HOME):',
        '  ~/.chatluna/skills',
        '  ~/.chatluna/agents',
        '',
        'Run `chatluna.agent sync` on the host to flush this working copy + sandbox files back.'
    ]
    process.stdout.write(lines.join('\n') + '\n')
}

function listSkills(cfg) {
    return Object.entries(cfg.skills.items).map(
        ([id, item]) =>
            `${id}\tenabled=${!!item.enabled}\tmode=${item.mode || 'description'}`
    )
}

function listSubAgents(cfg) {
    const out = []
    for (const name of Object.keys(cfg.subAgent.builtin))
        out.push(
            `builtin:${name}\tenabled=${!!cfg.subAgent.builtin[name].enabled}`
        )
    for (const id of Object.keys(cfg.subAgent.items))
        out.push(
            `markdown:${cfg.subAgent.items[id].name}\tid=${id}\tenabled=${!!cfg.subAgent.items[id].enabled}`
        )
    for (const name of Object.keys(cfg.subAgent.presetAgents))
        out.push(
            `preset:${name}\tenabled=${!!cfg.subAgent.presetAgents[name].enabled}`
        )
    return out
}

function listTools(cfg) {
    return Object.entries(cfg.tool.items).map(
        ([name, item]) =>
            `${name}\tenabled=${!!item.enabled}\tmain=${!!item.main}\tauthority=${item.authority ?? 0}`
    )
}

function printList(label, rows) {
    process.stdout.write(`${label}\n`)
    if (!rows.length) {
        process.stdout.write('  (none)\n')
        return 0
    }
    for (const r of rows) process.stdout.write(`  ${r}\n`)
    return 0
}

function printSkill(cfg, idOrName) {
    if (!idOrName) throw new Error('Usage: show skill <name|id>')
    const entry = findSkillEntry(cfg, idOrName)
    process.stdout.write(`skill ${entry.id}\n`)
    process.stdout.write(JSON.stringify(entry.item, null, 2) + '\n')
}

function printSubAgent(cfg, sel) {
    if (!sel) throw new Error('Usage: show subagent <selector>')
    const found = findSubAgent(cfg, sel)
    process.stdout.write(`subagent ${found.selector}\n`)
    process.stdout.write(JSON.stringify(found.item, null, 2) + '\n')
}

function printTool(cfg, name) {
    if (!name) throw new Error('Usage: show tool <name>')
    const item = cfg.tool.items[name]
    if (!item) throw new Error(`Tool not found: ${name}`)
    process.stdout.write(`tool ${name}\n`)
    process.stdout.write(JSON.stringify(item, null, 2) + '\n')
}

function printMcpServer(cfg, name) {
    if (!name) throw new Error('Usage: show mcp server <name>')
    const item = cfg.mcp.mcpServers[name]
    if (!item) throw new Error(`MCP server not found: ${name}`)
    process.stdout.write(`mcp server ${name}\n`)
    process.stdout.write(JSON.stringify(maskSecrets(item), null, 2) + '\n')
}

function printMcpTool(cfg, name) {
    if (!name) throw new Error('Usage: show mcp tool <name>')
    const item = cfg.mcp.tools[name]
    if (!item) throw new Error(`MCP tool not found: ${name}`)
    process.stdout.write(`mcp tool ${name}\n`)
    process.stdout.write(JSON.stringify(item, null, 2) + '\n')
}

// ----- mutations -----

function applyMutation(cfg, args) {
    const head = args[0]

    if (head === 'enable' || head === 'disable') {
        return mutateEnable(cfg, args, head === 'enable')
    }

    if (head === 'remove') return mutateRemove(cfg, args)
    if (head === 'set') return mutateSet(cfg, args)
    if (head === 'save' && args[1] === 'mcp' && args[2] === 'server')
        return mutateSaveMcpServer(cfg, args)

    throw new Error(`Unknown command: ${args.join(' ')}`)
}

function mutateEnable(cfg, args, enabled) {
    const kind = args[1]
    if (kind === 'skill') {
        const names = args.slice(2)
        if (!names.length)
            throw new Error(
                `Usage: ${enabled ? 'enable' : 'disable'} skill <name|id...>`
            )
        for (const n of names) {
            const entry = findSkillEntry(cfg, n)
            entry.item.enabled = enabled
            entry.item.mode = enabled ? entry.item.mode || 'description' : 'off'
        }
        return true
    }

    if (kind === 'subagent') {
        const names = args.slice(2)
        if (!names.length)
            throw new Error(
                `Usage: ${enabled ? 'enable' : 'disable'} subagent <selector...>`
            )
        for (const sel of names) {
            const found = findSubAgent(cfg, sel)
            found.item.enabled = enabled
        }
        return true
    }

    if (kind === 'tool') {
        const tail = args[args.length - 1]
        const main = tail === '--main' || tail === '--main-agent'
        const names = args.slice(2, main ? -1 : undefined)
        if (!names.length)
            throw new Error(
                `Usage: ${enabled ? 'enable' : 'disable'} tool <name...> [--main]`
            )
        for (const n of names) {
            const item = ensureToolItem(cfg, n)
            if (main) item.main = enabled
            else item.enabled = enabled
        }
        return true
    }

    throw new Error(`Unknown ${args[0]} target: ${kind}`)
}

function mutateRemove(cfg, args) {
    const kind = args[1]
    if (kind === 'skill') {
        const names = args.slice(2)
        if (!names.length) throw new Error('Usage: remove skill <name|id...>')
        for (const n of names) {
            const entry = findSkillEntry(cfg, n)
            delete cfg.skills.items[entry.id]
        }
        return true
    }
    if (kind === 'subagent') {
        const names = args.slice(2)
        if (!names.length)
            throw new Error('Usage: remove subagent <selector...>')
        for (const sel of names) {
            const found = findSubAgent(cfg, sel)
            if (found.bucket === 'builtin')
                throw new Error(`Cannot remove builtin sub-agent: ${sel}`)
            delete cfg.subAgent[found.bucket][found.key]
        }
        return true
    }
    if (kind === 'mcp' && args[2] === 'server') {
        const names = args.slice(3)
        if (!names.length) throw new Error('Usage: remove mcp server <name...>')
        for (const n of names) {
            if (!cfg.mcp.mcpServers[n])
                throw new Error(`MCP server not found: ${n}`)
            delete cfg.mcp.mcpServers[n]
        }
        return true
    }
    throw new Error(`Unknown remove target: ${kind}`)
}

function mutateSet(cfg, args) {
    const kind = args[1]
    if (kind === 'tool') return setTool(cfg, args)
    if (kind === 'subagent') return setSubAgentRule(cfg, args)
    if (kind === 'mcp' && args[2] === 'tool') return setMcpTool(cfg, args)
    throw new Error(`Unknown set target: ${kind}`)
}

function setTool(cfg, args) {
    const fields = [
        'enabled',
        'main',
        'chatluna',
        'character',
        'group',
        'private',
        'authority',
        'subagents'
    ]
    const idx = args.findIndex((a, i) => i >= 3 && fields.includes(a))
    if (idx < 0)
        throw new Error(`Usage: set tool <name...> <${fields.join('|')}> ...`)
    const names = args.slice(2, idx)
    if (!names.length) throw new Error('Missing tool name')

    const field = args[idx]
    const valueArgs = args.slice(idx + 1)

    for (const n of names) {
        const item = ensureToolItem(cfg, n)
        if (field === 'enabled') item.enabled = parseBool(valueArgs[0])
        else if (field === 'main') item.main = parseBool(valueArgs[0])
        else if (field === 'chatluna') item.chatluna = parseBool(valueArgs[0])
        else if (field === 'character') item.character = parseBool(valueArgs[0])
        else if (field === 'group')
            item.characterGroup = parseBool(valueArgs[0])
        else if (field === 'private')
            item.characterPrivate = parseBool(valueArgs[0])
        else if (field === 'authority')
            item.authority = parseAuthority(valueArgs[0])
        else if (field === 'subagents')
            item.subAgents = parseRule(valueArgs[0], valueArgs.slice(1), false)
    }
    return true
}

function setSubAgentRule(cfg, args) {
    const fields = ['tools', 'skills', 'mcp', 'computer']
    const idx = args.findIndex((a, i) => i >= 3 && fields.includes(a))
    if (idx < 0)
        throw new Error(
            `Usage: set subagent <selector...> <${fields.join('|')}> <all|allow|deny|inherit> [items...]`
        )
    const names = args.slice(2, idx)
    if (!names.length) throw new Error('Missing sub-agent selector')

    const field = args[idx]
    const rule = parseRule(args[idx + 1], args.slice(idx + 2), true)

    for (const sel of names) {
        const found = findSubAgent(cfg, sel)
        found.item.permissions = found.item.permissions || {
            tools: emptyRule('all'),
            skills: emptyRule('all'),
            mcp: emptyRule('all'),
            computer: emptyRule('all')
        }
        found.item.permissions[field] = rule
    }
    return true
}

function setMcpTool(cfg, args) {
    if (args[args.length - 2] !== 'enabled') {
        throw new Error('Usage: set mcp tool <name...> enabled <bool>')
    }
    const names = args.slice(3, -2)
    if (!names.length) throw new Error('Missing MCP tool name')
    const enabled = parseBool(args[args.length - 1])
    for (const n of names) {
        const item = cfg.mcp.tools[n] || {
            name: n,
            enabled: true,
            timeout: 30,
            selector: []
        }
        item.enabled = enabled
        cfg.mcp.tools[n] = item
    }
    return true
}

function mutateSaveMcpServer(cfg, args) {
    const name = args[3]
    if (!name) throw new Error('Usage: save mcp server <name> json <json>')
    if (args[4] !== 'json' || !args[5])
        throw new Error('Usage: save mcp server <name> json <json>')
    const json = JSON.parse(args[5])
    cfg.mcp.mcpServers[name] = json
    return true
}

// ----- helpers -----

function findSkillEntry(cfg, key) {
    if (cfg.skills.items[key]) return { id: key, item: cfg.skills.items[key] }
    for (const [id, item] of Object.entries(cfg.skills.items)) {
        if (item.name === key) return { id, item }
    }
    if (!cfg.skills.items[key]) {
        cfg.skills.items[key] = {
            enabled: true,
            mode: 'description'
        }
        return { id: key, item: cfg.skills.items[key] }
    }
    throw new Error(`Skill not found: ${key}`)
}

function findSubAgent(cfg, selector) {
    let bucket
    let key = selector
    const colon = selector.indexOf(':')
    if (colon > 0) {
        const head = selector.slice(0, colon)
        key = selector.slice(colon + 1)
        if (head === 'builtin') bucket = 'builtin'
        else if (head === 'preset') bucket = 'presetAgents'
        else if (head === 'markdown') bucket = 'items'
    }

    if (bucket && cfg.subAgent[bucket]) {
        if (cfg.subAgent[bucket][key]) {
            return { bucket, key, selector, item: cfg.subAgent[bucket][key] }
        }
        if (bucket === 'items') {
            for (const [id, item] of Object.entries(cfg.subAgent.items)) {
                if (item.name === key)
                    return { bucket, key: id, selector, item }
            }
        }
    }

    for (const [name, item] of Object.entries(cfg.subAgent.builtin || {})) {
        if (name === selector || item.name === selector)
            return { bucket: 'builtin', key: name, selector, item }
    }
    for (const [id, item] of Object.entries(cfg.subAgent.items || {})) {
        if (id === selector || item.name === selector)
            return { bucket: 'items', key: id, selector, item }
    }
    for (const [name, item] of Object.entries(
        cfg.subAgent.presetAgents || {}
    )) {
        if (name === selector || item.name === selector)
            return { bucket: 'presetAgents', key: name, selector, item }
    }
    throw new Error(`Sub-agent not found: ${selector}`)
}

function ensureToolItem(cfg, name) {
    if (!cfg.tool.items[name]) {
        cfg.tool.items[name] = {
            enabled: true,
            main: true,
            chatluna: true,
            character: true,
            characterGroup: true,
            characterPrivate: true,
            characterGroupMode: 'all',
            characterPrivateMode: 'all',
            characterGroupIds: [],
            characterPrivateIds: [],
            subAgents: emptyRule('all'),
            authority: 0
        }
    }
    return cfg.tool.items[name]
}

function parseBool(raw) {
    if (raw == null) throw new Error('Missing boolean value')
    const v = String(raw).toLowerCase()
    if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(v)) return true
    if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(v))
        return false
    throw new Error(`Invalid boolean: ${raw}`)
}

function parseAuthority(raw) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 5)
        throw new Error(`Invalid authority: ${raw}`)
    return n
}

function parseRule(mode, items, allowInherit) {
    if (!mode) throw new Error('Missing permission mode')
    const m = mode.toLowerCase()
    if (m === 'all') return { mode: 'all', allow: [], deny: [] }
    if (m === 'allow') return { mode: 'allow', allow: items.slice(), deny: [] }
    if (m === 'deny') return { mode: 'deny', allow: [], deny: items.slice() }
    if (m === 'inherit' && allowInherit)
        return { mode: 'inherit', allow: [], deny: [] }
    throw new Error(`Invalid mode: ${mode}`)
}

function maskSecrets(cfg) {
    const c = JSON.parse(JSON.stringify(cfg))
    if (c.env) for (const k of Object.keys(c.env)) c.env[k] = '***'
    if (c.headers) for (const k of Object.keys(c.headers)) c.headers[k] = '***'
    if (c.apiKey) c.apiKey = '***'
    return c
}

function printHelp() {
    process.stdout.write(`agentcli — sandbox-side ChatLuna agent config editor

Usage:
  node bin/agentcli.cjs show overview
  node bin/agentcli.cjs show <skills|skill|subagents|subagent|tools|tool|mcp ...>
  node bin/agentcli.cjs enable|disable skill <name|id...>
  node bin/agentcli.cjs enable|disable subagent <selector...>
  node bin/agentcli.cjs enable|disable tool <name...> [--main]
  node bin/agentcli.cjs remove skill <name|id...>
  node bin/agentcli.cjs remove subagent <selector...>
  node bin/agentcli.cjs remove mcp server <name...>
  node bin/agentcli.cjs set tool <name...> <enabled|main|chatluna|character|group|private|authority|subagents> ...
  node bin/agentcli.cjs set subagent <selector...> <tools|skills|mcp|computer> <all|allow|deny|inherit> [items...]
  node bin/agentcli.cjs set mcp tool <name...> enabled <bool>
  node bin/agentcli.cjs save mcp server <name> json '<json>'

Edits go to ${CONFIG_PATH}. Run \`chatluna.agent sync\` on the host to flush.
`)
}

process.exit(main(process.argv.slice(2)))
