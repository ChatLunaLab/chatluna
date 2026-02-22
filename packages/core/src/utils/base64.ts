export function getBase64EncodedSize(rawBytes: number): number {
    if (!Number.isFinite(rawBytes) || rawBytes <= 0) {
        return 0
    }
    return Math.ceil(rawBytes / 3) * 4
}
