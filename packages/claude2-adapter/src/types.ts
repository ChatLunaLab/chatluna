/* {"uuid":"764a6aae-7639-4bb1-8e3d-08f6b42110ab","name":"?","join_token":"?","created_at":"2023-07-11T16:23:04.227989+00:00","updated_at":"2023-07-11T16:23:28.971128+00:00","capabilities":["chat","legacy_non_strict_params"],"settings":{"claude_console_privacy":"default_private"},"active_flags":[]}
 */

export interface ClaudeOrganizationResponse {
    uuid: string;
    name: string;
    join_token: string;
    created_at: string;
    updated_at: string;
    capabilities: string[];
    settings: {
        claude_console_privacy: string;
    };
    active_flags: string[];
}

/** {"completion":" Hello! I'm Claude, an AI assistant created by Anthropic. How can I help you today?","stop_reason":null,"model":"claude-2.0","truncated":false,"stop":null,"log_id":"?","exception":null,"messageLimit":{"type":"within_limit"}} */

export interface ClaudeChatResponse {
    completion: string;
    stop_reason: null;
    model: string;
    truncated: boolean;
    stop: string | null;
    log_id: string;
    exception: string | null;
    messageLimit: {
        type: string;
    };
}

/** {"uuid":"?","name":"","summary":"","created_at":"2023-07-13T21:34:50.757530+00:00","updated_at":"2023-07-13T21:34:50.757530+00:00"} */

export interface ClaudeCreateConversationResponse {
    uuid: string;
    name: string;
    summary: string;
    created_at: string;
    updated_at: string;
}

/** {"completion":{"prompt":"Hello","timezone":"Asia/Hong_Kong","model":"claude-2"},"organization_uuid":"764a6aae-7639-4bb1-8e3d-08f6b42110ab","conversation_uuid":"c19f785e-f3f3-43e4-b0f6-342197884f8b","text":"Hello","attachments":[]} */

export interface ClaudeSendMessageRequest {
    completion: {
        prompt: string;
        timezone: string;
        model: string;
    };
    organization_uuid: string;
    conversation_uuid: string;
    text: string;
    attachments: string[];
}