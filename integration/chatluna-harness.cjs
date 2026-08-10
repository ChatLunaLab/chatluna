const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { Context } = require('koishi')
const memory = require('@koishijs/plugin-database-memory').default
const server = require('@koishijs/plugin-server').default
const NodeConsole = require('@koishijs/plugin-console').default
const mock = require('@koishijs/plugin-mock')
const chatluna = require('koishi-plugin-chatluna')
const { ChatLunaService } = require('koishi-plugin-chatluna/services/chat')
const agent = require('koishi-plugin-chatluna-agent')

const live = process.argv.includes('--live')
const profile = live ? 'live' : 'default'
const config = live
    ? {
          apiKey: process.env.CHATLUNA_LIVE_API_KEY,
          baseUrl: process.env.CHATLUNA_LIVE_BASE_URL,
          model: process.env.CHATLUNA_LIVE_MODEL,
          platform: process.env.CHATLUNA_LIVE_PLATFORM,
          prompt: process.env.CHATLUNA_LIVE_PROMPT
      }
    : undefined

if (live) {
    const missing = Object.entries(config)
        .filter(([, value]) => !value)
        .map(
            ([name]) =>
                `CHATLUNA_LIVE_${name === 'apiKey' ? 'API_KEY' : name === 'baseUrl' ? 'BASE_URL' : name.toUpperCase()}`
        )
    if (missing.length) {
        throw new Error(
            `Missing required live environment: ${missing.join(', ')}`
        )
    }
}

async function main() {
    const cwd = process.cwd()
    const baseDir = await mkdtemp(join(tmpdir(), 'chatluna-integration-'))
    process.chdir(baseDir)
    const app = new Context()
    app.baseDir = baseDir
    const forks = []

    try {
        forks.push(app.plugin(memory))
        forks.push(app.plugin(server, { host: '127.0.0.1', port: 0 }))
        forks.push(app.plugin(NodeConsole, { open: false }))
        forks.push(
            app.plugin(chatluna, {
                defaultModel: live
                    ? `${config.platform}/${config.model}`
                    : '无',
                privateChatWithoutCommand: live
            })
        )
        forks.push(app.plugin(agent))
        forks.push(app.plugin(mock.default))

        if (live) {
            const adapter = require('koishi-plugin-chatluna-openai-like-adapter')
            forks.push(
                app.plugin(adapter, {
                    platform: config.platform,
                    apiKeys: [[config.apiKey, config.baseUrl, true]],
                    pullModels: false,
                    additionalModels: [
                        {
                            model: config.model,
                            modelType: 'LLM 大语言模型',
                            modelCapabilities: ['text_input', 'tool_call'],
                            contextSize: 128000
                        }
                    ]
                })
            )
        }

        let session
        app.middleware((current, next) => {
            session = current
            return next()
        }, true)

        await app.start()

        const client = app.mock.client('integration-user')
        assert(client instanceof mock.MessageClient)
        assert(app.bots[0] instanceof mock.MockBot)

        const replies = await client.receive(
            live ? config.prompt : 'chatluna integration probe'
        )
        assert(session)
        assert(
            session.app === app,
            'session must belong to the harness Context'
        )
        assert(session.bot instanceof mock.MockBot)
        assert.equal(session.isDirect, true)

        assert(app.chatluna instanceof ChatLunaService)
        assert(app.console instanceof NodeConsole)
        assert(app.chatluna.conversation)
        assert(app.chatluna_agent)
        assert(app.mock instanceof mock.MockAdapter)
        for (const name of [
            'database',
            'server',
            'console',
            'chatluna',
            'chatluna_agent',
            'mock'
        ]) {
            assert(app.root[name], `${name} must be registered on app.root`)
            assert.equal(app.root[name].ctx, app.root)
        }

        const result = await app.chatluna.conversation.resolveConversation(
            session,
            { mode: 'active' }
        )
        assert(result.conversation)
        assert.equal(result.conversationId, result.conversation.id)

        const persisted = await app.database.get('chatluna_conversation', {
            id: result.conversation.id
        })
        assert.equal(persisted.length, 1)
        assert.equal(persisted[0].id, result.conversation.id)

        process.stdout.write(
            `${JSON.stringify(
                {
                    profile,
                    serviceConstructors: {
                        database: app.database.constructor.name,
                        server: app.server.constructor.name,
                        console: app.console.constructor.name,
                        chatluna: app.chatluna.constructor.name,
                        conversation:
                            app.chatluna.conversation.constructor.name,
                        agent: app.chatluna_agent.constructor.name,
                        mock: app.mock.constructor.name,
                        bot: app.bots[0].constructor.name,
                        client: client.constructor.name,
                        session: session.constructor.name
                    },
                    conversationId: result.conversation.id,
                    replyCount: replies.length
                },
                null,
                2
            )}\n`
        )
    } finally {
        try {
            for (const fork of forks.reverse()) {
                fork.dispose()
            }
            await app.lifecycle.flush()
        } finally {
            try {
                await app.stop()
            } finally {
                process.chdir(cwd)
                await rm(baseDir, { recursive: true, force: true })
            }
        }
    }
}

main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exitCode = 1
})
