import { ChatHubAuthService } from './service'

export interface ChatHubAuthUser {
    userId: string
    balance: number
    authType: AuthType
    groups?: number[]
}

export type AuthType = 'guest' | 'user' | 'admin'

export interface ChatHubAuthGroup {
    name: string
    platform?: string
    id: number
    limitPerMin: number
    limitPerDay: number

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
    }
}
