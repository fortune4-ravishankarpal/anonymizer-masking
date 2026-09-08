import { createCipheriv, createHash, randomBytes } from 'node:crypto'

export type EncryptedMetadata = {
    algorithm: 'aes-256-gcm'
    authTag: string
    ciphertext: string
    iv: string
}

const getEncryptionKey = (secret: string): Buffer => {
    const key = /^[0-9a-f]{64}$/i.test(secret)
        ? Buffer.from(secret, 'hex')
        : Buffer.from(secret, 'base64')

    if (key.length !== 32) {
        throw new Error('metadataEncryptionKey must be a 32-byte base64 or 64-character hex value')
    }

    return key
}

export const deriveMetadataKey = (environmentKey: string, databaseKey: string): string =>
    createHash('sha256')
        .update('anonymizer-masking:metadata-key:v1')
        .update(environmentKey)
        .update(databaseKey)
        .digest('hex')

export const encryptMetadata = (metadata: unknown, secret: string): EncryptedMetadata => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(secret), iv)
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(metadata), 'utf8'),
        cipher.final(),
    ])

    return {
        algorithm: 'aes-256-gcm',
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
    }
}
