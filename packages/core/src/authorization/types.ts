import { ChatHubAuthService } from './service'

export interface ChatHubAuthUser {
    userId: string
    balance: number
    authType: AuthType
}

export interface ChatHubAuthJoinedUser {
    userId: string
    groupId: number
    groupName: string
    id: number
}

export type AuthType = 'guest' | 'user' | 'admin'

export interface ChatHubAuthGroup {
    name: string
    platform?: string
    id: number
    limitPerMin: number
    limitPerDay: number

    constPerToken: number

    currentLimitPerMin?: number
    currentLimitPerDay?: number

    lastCallTime?: number

    supportModels: string[]
}

declare module 'koishi' {
    interface Context {
        chathub_auth: ChatHubAuthService
    }

    interface Tables {
        chathub_auth_group: ChatHubAuthGroup
        chathub_auth_user: ChatHubAuthUser
        chathub_auth_joined_user: ChatHubAuthJoinedUser
    }
}
