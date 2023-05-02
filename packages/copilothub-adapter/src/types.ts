

export interface CopilotResponse { 
    result: string
    sources: string[]
    quota: number
    default_quota: number
    package_quota: number
}

export interface CopilotMessage {
    role: 'user' | 'system' | 'model',
    content: string,
    name: string
}
