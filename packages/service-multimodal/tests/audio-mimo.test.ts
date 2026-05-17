import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ModelCapabilities } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    MIMO_BASE64_AUDIO_BYTES,
    MIMO_BASE64_IMAGE_BYTES,
    buildAudioContent,
    buildImageContent,
    isMimoAudioMime,
    isMimoImageMime,
    modelCanReadAudio,
    modelCanReadImage
} from '../src/audio'
import { detectAudioMimeType } from '../src/media'
import { readFilesInputSchema } from '../src/read_files_schema'

test('recognizes MiMo audio models even when adapter metadata lacks AudioInput', () => {
    assert.equal(
        modelCanReadAudio(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'unifyllm/mimo-v2.5'
        ),
        true
    )
    assert.equal(
        modelCanReadAudio(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'mimo-v2-omni'
        ),
        true
    )
    assert.equal(
        modelCanReadAudio(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'unifyllm/deepseek-v4-flash'
        ),
        false
    )
})

test('uses MiMo input_audio data URL instead of ChatLuna audio_url', () => {
    assert.deepEqual(buildAudioContent('mimo-v2.5', 'abc', 'audio/mpeg'), {
        type: 'input_audio',
        input_audio: {
            data: 'data:audio/mpeg;base64,abc'
        }
    })
    assert.deepEqual(buildAudioContent('gpt-4o-audio', 'abc', 'audio/mpeg'), {
        type: 'audio_url',
        audio_url: {
            url: 'data:audio/mpeg;base64,abc',
            mimeType: 'audio/mpeg'
        }
    })
})

test('keeps MiMo base64 audio within the documented 50 MB limit', () => {
    assert.equal(MIMO_BASE64_AUDIO_BYTES, 50 * 1024 * 1024)
    assert.equal(isMimoAudioMime('audio/mpeg'), true)
    assert.equal(isMimoAudioMime('audio/wav'), true)
    assert.equal(isMimoAudioMime('audio/flac'), true)
    assert.equal(isMimoAudioMime('audio/mp4'), true)
    assert.equal(isMimoAudioMime('audio/ogg'), true)
    assert.equal(isMimoAudioMime('audio/aac'), false)
})

test('recognizes MiMo image models even when adapter metadata lacks ImageInput', () => {
    assert.equal(
        modelCanReadImage(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'unifyllm/mimo-v2.5'
        ),
        true
    )
    assert.equal(
        modelCanReadImage(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'mimo-v2-omni'
        ),
        true
    )
    assert.equal(
        modelCanReadImage(
            { value: { capabilities: [ModelCapabilities.ToolCall] } },
            'unifyllm/deepseek-v4-flash'
        ),
        false
    )
})

test('uses OpenAI image_url content for MiMo images', () => {
    assert.deepEqual(buildImageContent('abc', 'image/png'), {
        type: 'image_url',
        image_url: {
            url: 'data:image/png;base64,abc'
        }
    })
})

test('keeps MiMo base64 images within the documented 50 MB limit', () => {
    assert.equal(MIMO_BASE64_IMAGE_BYTES, 50 * 1024 * 1024)
    assert.equal(isMimoImageMime('image/jpeg'), true)
    assert.equal(isMimoImageMime('image/png'), true)
    assert.equal(isMimoImageMime('image/gif'), true)
    assert.equal(isMimoImageMime('image/webp'), true)
    assert.equal(isMimoImageMime('image/bmp'), true)
    assert.equal(isMimoImageMime('image/svg+xml'), false)
})

test('accepts JSON-stringified read_files input from tool calls', () => {
    assert.deepEqual(
        readFilesInputSchema.parse({
            files: '{"url":"http://127.0.0.1:5140/image.png"}'
        }),
        {
            files: {
                url: 'http://127.0.0.1:5140/image.png'
            }
        }
    )

    assert.deepEqual(
        readFilesInputSchema.parse({
            files: '[{"url":"http://127.0.0.1:5140/image.png"}]'
        }),
        {
            files: [
                {
                    url: 'http://127.0.0.1:5140/image.png'
                }
            ]
        }
    )
})

test('detects AMR audio even when storage declares it as MP3', () => {
    assert.equal(
        detectAudioMimeType(Buffer.from('#!AMR\nabc'), 'audio/mp3'),
        'audio/amr'
    )
    assert.equal(
        detectAudioMimeType(Buffer.from('#!AMR\nabc'), null),
        'audio/amr'
    )
    assert.equal(
        detectAudioMimeType(Buffer.from('ID3abc'), 'audio/mp3'),
        'audio/mpeg'
    )
})
