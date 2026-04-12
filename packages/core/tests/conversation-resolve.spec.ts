/// <reference types="mocha" />

import { assert } from 'chai'
import { ChainMiddlewareRunStatus } from '../src/chains/chain'
import { apply as applyResolve } from '../src/middlewares/conversation/resolve_conversation'
import { apply as applyRequest } from '../src/middlewares/conversation/request_conversation'
import { createMemoryService, createSession } from './helpers'

it('resolve_conversation inherits active preset lane for explicit commands without target', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let useRoutePresetLane: boolean | undefined

        ctx.chatluna.conversation.resolveContext = async (_session, opts) => {
            useRoutePresetLane = opts.useRoutePresetLane
            return {
                bindingKey: 'shared:discord:bot:guild:preset:helper',
                constraint: {},
                effectiveModel: 'test-platform/test-model',
                effectivePreset: 'default-preset',
                effectiveChatMode: 'plugin',
                conversation: null
            }
        }

        applyResolve(
            ctx as never,
            {} as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        },
                        before() {
                            return this
                        }
                    }
                }
            } as never
        )

        const status = await run!(session, {
            command: 'chat',
            options: {}
        })

        assert.equal(status, ChainMiddlewareRunStatus.CONTINUE)
        assert.equal(useRoutePresetLane, true)
    } finally {
        await app.stop()
    }
})

it('request_conversation inherits active preset lane for explicit commands without target', async () => {
    const { app, ctx } = await createMemoryService()

    try {
        const session = createSession() as any
        let run:
            | ((
                  session: any,
                  context: any
              ) => Promise<ChainMiddlewareRunStatus>)
            | undefined
        let useRoutePresetLane: boolean | undefined

        ctx.chatluna.conversation.ensureActiveConversation = async (
            _session,
            opts
        ) => {
            useRoutePresetLane = opts.useRoutePresetLane
            throw new Error('stop-after-ensure')
        }

        applyRequest(
            ctx as never,
            {
                streamResponse: false,
                splitMessage: false
            } as never,
            {
                middleware: (_name, fn) => {
                    run = fn as never
                    return {
                        after() {
                            return this
                        }
                    }
                }
            } as never
        )

        try {
            await run!(session, {
                command: 'voice',
                options: {
                    inputMessage: {
                        content: 'hello'
                    }
                }
            })
            assert.fail('Expected middleware to stop after ensure.')
        } catch (err) {
            assert.match(String(err), /stop-after-ensure/)
        }

        assert.equal(useRoutePresetLane, true)
    } finally {
        await app.stop()
    }
})
