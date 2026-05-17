export function detectAudioMimeType(
    buffer: Buffer,
    declaredMimeType?: string | null
): string | null {
    const header = buffer.subarray(0, 16).toString('latin1')

    if (header.startsWith('#!AMR')) return 'audio/amr'
    if (
        header.startsWith('#!SILK_V3') ||
        buffer.subarray(1, 10).toString('latin1') === '#!SILK_V3'
    ) {
        return 'audio/silk'
    }
    if (
        header.startsWith('ID3') ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
        return 'audio/mpeg'
    }
    if (
        header.startsWith('RIFF') &&
        buffer.subarray(8, 12).toString('latin1') === 'WAVE'
    ) {
        return 'audio/wav'
    }
    if (header.startsWith('fLaC')) return 'audio/flac'
    if (header.startsWith('OggS')) return 'audio/ogg'

    return declaredMimeType ?? null
}
