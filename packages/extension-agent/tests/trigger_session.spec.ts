import { expect } from 'chai'
import { buildVirtualSession } from '../src/trigger/session'

describe('buildVirtualSession', () => {
    it('builds a routed virtual session payload', () => {
        const event = buildVirtualSession(
            {
                session: (input) => ({ event: input })
            } as never,
            {
                platform: 'test',
                selfId: 'bot',
                userId: 'user',
                channelId: 'channel',
                isDirect: false
            },
            {
                messageName: 'trigger',
                message: [
                    { type: 'text', text: 'hello' },
                    {
                        type: 'image_url',
                        image_url: 'https://example.com/a.png'
                    }
                ]
            }
        ) as {
            event: {
                channel: {
                    id: string
                    type: number
                }
                platform: string
                selfId: string
                type: string
                user: {
                    id: string
                    name: string
                }
                message: {
                    content: string
                    elements: Array<{ type: string }>
                }
            }
        }

        expect(event.event.type).to.equal('message')
        expect(event.event.platform).to.equal('test')
        expect(event.event.selfId).to.equal('bot')
        expect(event.event.channel.id).to.equal('channel')
        expect(event.event.channel.type).to.equal(0)
        expect(event.event.user.id).to.equal('user')
        expect(event.event.user.name).to.equal('trigger')
        expect(event.event.message).to.not.have.property('id')
        expect(event.event.message.content).to.equal('hello')
        expect(event.event.message.elements).to.have.length(2)
        expect(event.event.message.elements[0].type).to.equal('text')
        expect(event.event.message.elements[1].type).to.not.equal('text')
    })

    it('uses guild routing for grouped sessions', () => {
        const event = buildVirtualSession(
            {
                session: (input) => ({ event: input })
            } as never,
            {
                platform: 'test',
                selfId: 'bot',
                userId: 'user',
                guildId: 'guild',
                isDirect: false
            },
            {
                message: 'hello'
            }
        ) as {
            event: {
                channel: {
                    id: string
                    type: number
                }
                guild?: {
                    id: string
                }
                message: {
                    content: string
                    elements: Array<{ type: string }>
                }
                user: {
                    name: string
                }
            }
        }

        expect(event.event.channel.id).to.equal('guild')
        expect(event.event.channel.type).to.equal(0)
        expect(event.event.guild?.id).to.equal('guild')
        expect(event.event.user.name).to.equal('trigger')
        expect(event.event.message.content).to.equal('hello')
        expect(event.event.message.elements).to.have.length(1)
        expect(event.event.message.elements[0].type).to.equal('text')
    })

    it('marks direct routing with a private channel type', () => {
        const event = buildVirtualSession(
            {
                session: (input) => ({ event: input })
            } as never,
            {
                platform: 'test',
                selfId: 'bot',
                userId: 'user',
                isDirect: true
            },
            {
                message: 'hello'
            }
        ) as {
            event: {
                channel: {
                    id: string
                    type: number
                }
                guild?: {
                    id: string
                }
            }
        }

        expect(event.event.channel.id).to.equal('user')
        expect(event.event.channel.type).to.equal(1)
        expect(event.event.guild).to.equal(undefined)
    })
})
