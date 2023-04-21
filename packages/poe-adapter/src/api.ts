import { Context } from 'koishi'

import { request, createLogger } from '@dingyi222666/koishi-plugin-chathub'
import PoeAdapter from './index'
import graphqlModel from './graphql';
import { PoeQueryChatIdResponse, PoeRequestHeaders, PoeRequestInit, PoeSettingsResponse } from './types'
import md5 from 'md5'
import randomUseragent from 'random-useragent'

const logger = createLogger('@dingyi222666/chathub-poe-adapter/api')

export class Api {


    private settings: PoeSettingsResponse | null = null

    private poeRequestInit: PoeRequestInit

    private headers: PoeRequestHeaders | any = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://poe.com",
        Connection: 'keep-alive',
        "User-Agent": randomUseragent.getRandom()
    }


    constructor(
        private readonly config: PoeAdapter.Config,
        private readonly ctx: Context
    ) {
        this.headers.Cookie = config.cookie
        this.poeRequestInit = {
            modelId: config.model
        }
    }

    async makeRequest(requestBody: any) {
        requestBody = JSON.stringify(requestBody)
        this.headers['poe-tag-id'] = md5(request + this.headers['poe-formkey'] + 'WpuLMiXEKKE98j56k')
        const response = await request.fetch('https://poe.com/api/gql_POST', {
            method: 'POST',
            headers: this.headers,
            body: requestBody
        })
        return await response.json()
    }

    async sendMessage(query: string) {
        try {
            const result = await this.makeRequest({
                query: graphqlModel.addHumanMessageMutation,
                variables: {
                    bot: this.poeRequestInit.modelId,
                    chatId: this.poeRequestInit.chatId,
                    query: query,
                    source: null,
                    withChatBreak: false,
                },
            })

            logger.debug(`Send Message: ${query}`)

            return result
        } catch (e) {
        }
    }

    async request(prompt: string): Promise<string | Error> {

        if (!this.settings || !this.headers['poe-formkey']) {
            await this.getCredentials()
        }

        const ws = await this.connectToWebSocket()
        await this.subscribe()

        const listenerPromise = this.buildListenerPromise(ws)

        this.sendMessage(prompt)

        const result = await listenerPromise

        await this.closeWebSocketConnection(ws)

        return result
    }

    private async buildListenerPromise(ws: WebSocket): Promise<string | Error> {
        return new Promise((resolve) => {
            let complete = false
            ws.onmessage = (e) => {
                const jsonData = JSON.parse(e.data)
                logger.debug(`WebSocket Message: ${e}`)
                if (jsonData.messages && jsonData.messages.length > 0) {
                    const messages = JSON.parse(jsonData.messages[0])
                    const dataPayload = messages.payload.data
                    const text = dataPayload.messageAdded.text
                    const state = dataPayload.messageAdded.state
              /*   if (state !== 'complete') {
                  const differences = diff.diffChars(previousText, text)
                  let result = ''
                  differences.forEach((part) => {
                    if (part.added) {
                      result += part.value
                    }
                  })
                  previousText = text
                  if (onMessage) onMessage(result)
                } else */ if (dataPayload.messageAdded.author !== 'human' && state === 'complete') {
                        if (!complete) {
                            complete = true
                            return resolve(text)
                        }
                    }
                }
            }
        })
    }

    private async connectToWebSocket(): Promise<WebSocket> {
        const url = this.getWebSocketUrl()
        const ws = new WebSocket(url)
        return new Promise((resolve) => {
            ws.onopen = () => {
                logger.debug('WebSocket Connected')
                return resolve(ws)
            }
        })
    }

    private getWebSocketUrl() {
        const tchRand = Math.floor(100000 + Math.random() * 900000) // They're surely using 6 digit random number for ws url.
        const socketUrl = `wss://tch${tchRand}.tch.quora.com`
        const boxName = this.settings.tchannelData.boxName
        const minSeq = this.settings.tchannelData.minSeq
        const channel = this.settings.tchannelData.channel
        const hash = this.settings.tchannelData.channelHash
        return `${socketUrl}/up/${boxName}/updates?min_seq=${minSeq}&channel=${channel}&hash=${hash}`
    }

    private async getCredentials() {
        this.settings = await (
            await request.fetch('https://poe.com/api/settings', { headers: this.headers })
        ).json() as PoeSettingsResponse

        logger.debug('poe settings', JSON.stringify(this.settings))

        if (this.settings.tchannelData.channel) {
            this.headers['poe-tchannel'] = this.settings.tchannelData.channel
        }

        this.headers['poe-formkey'] = await this.getFormkey()
        logger.debug('poe formkey', this.headers['poe-formkey'])
    }


    private async getFormkey(): Promise<string> {
        const source = (await (await fetch('https://poe.com')).text())

        return extractFormkey(source)
    }

    private async subscribe() {
        const query = {
            queryName: 'subscriptionsMutation',
            variables: {
                subscriptions: [
                    {
                        subscriptionName: 'messageAdded',
                        query: 'subscription subscriptions_messageAdded_Subscription(\n  $chatId: BigInt!\n) {\n  messageAdded(chatId: $chatId) {\n    id\n    messageId\n    creationTime\n    state\n    ...ChatMessage_message\n    ...chatHelpers_isBotMessage\n  }\n}\n\nfragment ChatMessageDownvotedButton_message on Message {\n  ...MessageFeedbackReasonModal_message\n  ...MessageFeedbackOtherModal_message\n}\n\nfragment ChatMessageDropdownMenu_message on Message {\n  id\n  messageId\n  vote\n  text\n  ...chatHelpers_isBotMessage\n}\n\nfragment ChatMessageFeedbackButtons_message on Message {\n  id\n  messageId\n  vote\n  voteReason\n  ...ChatMessageDownvotedButton_message\n}\n\nfragment ChatMessageOverflowButton_message on Message {\n  text\n  ...ChatMessageDropdownMenu_message\n  ...chatHelpers_isBotMessage\n}\n\nfragment ChatMessageSuggestedReplies_SuggestedReplyButton_message on Message {\n  messageId\n}\n\nfragment ChatMessageSuggestedReplies_message on Message {\n  suggestedReplies\n  ...ChatMessageSuggestedReplies_SuggestedReplyButton_message\n}\n\nfragment ChatMessage_message on Message {\n  id\n  messageId\n  text\n  author\n  linkifiedText\n  state\n  ...ChatMessageSuggestedReplies_message\n  ...ChatMessageFeedbackButtons_message\n  ...ChatMessageOverflowButton_message\n  ...chatHelpers_isHumanMessage\n  ...chatHelpers_isBotMessage\n  ...chatHelpers_isChatBreak\n  ...chatHelpers_useTimeoutLevel\n  ...MarkdownLinkInner_message\n}\n\nfragment MarkdownLinkInner_message on Message {\n  messageId\n}\n\nfragment MessageFeedbackOtherModal_message on Message {\n  id\n  messageId\n}\n\nfragment MessageFeedbackReasonModal_message on Message {\n  id\n  messageId\n}\n\nfragment chatHelpers_isBotMessage on Message {\n  ...chatHelpers_isHumanMessage\n  ...chatHelpers_isChatBreak\n}\n\nfragment chatHelpers_isChatBreak on Message {\n  author\n}\n\nfragment chatHelpers_isHumanMessage on Message {\n  author\n}\n\nfragment chatHelpers_useTimeoutLevel on Message {\n  id\n  state\n  text\n  messageId\n}\n'
                    },
                    {
                        subscriptionName: 'viewerStateUpdated',
                        query: 'subscription subscriptions_viewerStateUpdated_Subscription {\n  viewerStateUpdated {\n    id\n    ...ChatPageBotSwitcher_viewer\n  }\n}\n\nfragment BotHeader_bot on Bot {\n  displayName\n  ...BotImage_bot\n}\n\nfragment BotImage_bot on Bot {\n  profilePicture\n  displayName\n}\n\nfragment BotLink_bot on Bot {\n  displayName\n}\n\nfragment ChatPageBotSwitcher_viewer on Viewer {\n  availableBots {\n    id\n    ...BotLink_bot\n    ...BotHeader_bot\n  }\n}\n'
                    }
                ]
            },
            query: 'mutation subscriptionsMutation(\n  $subscriptions: [AutoSubscriptionQuery!]!\n) {\n  autoSubscribe(subscriptions: $subscriptions) {\n    viewer {\n      id\n    }\n  }\n}\n'
        };

        await this.makeRequest(query);
    }

    private async closeWebSocketConnection(ws: WebSocket): Promise<boolean> {
        return new Promise((resolve, reject) => {
            ws.onclose = () => {
                resolve(true)
            }
            try {
                ws.close()
            } catch (e) {
                reject(e)
            }
        })
    }

    async closeConnect() {
        this.settings = null
        this.headers['poe-formkey'] = null
    }

    private async getChatId(bot: string) {
        const {
            data: {
                chatOfBot: { chatId },
            },
        } = await this.makeRequest({
            query: graphqlModel.chatViewQuery,
            variables: {
                bot,
            },
        }) as PoeQueryChatIdResponse
        return chatId
    }

    async clearContext() {
        try {
            const result = await this.makeRequest({
                query: `${graphqlModel.addMessageBreakMutation}`,
                variables: { chatId: this.poeRequestInit.chatId },
            })

            logger.debug('clear context', JSON.stringify(result))

            return true
        } catch (e) {
            logger.error(e)
            return false
        }
    }
}


function extractFormkey(source: string) {
    const scriptRegex = /<script>if\(.+\)throw new Error;(.+)<\/script>/;
    const scriptText = source.match(scriptRegex)[1];
    const keyRegex = /var .="([0-9a-f]+)",/;
    const keyText = scriptText.match(keyRegex)[1];
    const cipherRegex = /\.(\d+)=\.(\d+)/;
    const cipherPairs = scriptText.matchAll(cipherRegex);
    const formkeyList = Array.from(cipherPairs).map((pair) => { return keyText[parseInt(pair[2])] });
    return formkeyList.join("");
}

