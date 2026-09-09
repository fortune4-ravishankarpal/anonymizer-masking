import { randomUUID } from 'node:crypto'

import type { CollectionSlug, TaskConfig } from 'payload'

import type { AnonymizationCollectionConfig, AnonymizationValue } from '../index.js'
import { deriveMetadataKey, encryptMetadata } from '../utils/encryptMetadata.js'

const resolveValue = (value: AnonymizationValue, anonymousId: string): unknown =>
    typeof value === 'function' ? value({ anonymousId }) : value

export type AnonymizeTaskInput = {
    requestId: string
    encryptionKey?: string
    metadataEnabled?: boolean
}

export const createAnonymizeTask = (
    configuredCollections: Record<string, AnonymizationCollectionConfig>,
): TaskConfig<'anonymizeDataTask'> => ({
    slug: 'anonymizeDataTask',
    inputSchema: [
        {
            name: 'requestId',
            type: 'text',
            required: true,
            label: 'Anonymization Request ID',
        },
        {
            name: 'encryptionKey',
            type: 'text',
            label: 'Encryption Key (optional)',
        },
        {
            name: 'metadataEnabled',
            type: 'checkbox',
            label: 'Enable Metadata Storage',
        },
    ],
    outputSchema: [
        {
            name: 'anonymousId',
            type: 'text',
            required: true,
        },
        {
            name: 'collectionsProcessed',
            type: 'number',
            required: true,
        },
        {
            name: 'totalDocumentsMasked',
            type: 'number',
            required: true,
        },
    ],
    retries: 3,

    handler: async ({ input, req }) => {
        const taskInput = input as AnonymizeTaskInput

        const startedAtMs = Date.now()
        const anonymousId = randomUUID()
        let totalDocumentsMasked = 0
        const processedRecords: Array<{ collection: string; id: string }> = []
        const collectionResults: Array<{
            collection: string
            documentsMasked: number
            fields: string[]
        }> = []
        const originalData: Record<string, Array<{ id: string; data: unknown }>> = {}
        const maskedFields: Record<string, string[]> = {}

        try {
            // 1. Fetch the anonymization request
            const requestRecord = await req.payload.findByID({
                collection: 'anonymization-requests',
                id: taskInput.requestId,
                overrideAccess: true,
            })

            if (!requestRecord) {
                throw new Error(`Anonymization request ${taskInput.requestId} not found`)
            }

            const userId =
                typeof requestRecord.user === 'object' ? requestRecord.user.id : requestRecord.user

            if (!userId) {
                throw new Error('Request has no associated user')
            }

            // 2. Begin a transaction for the entire anonymization process
            const transactionID = await req.payload.db.beginTransaction()

            if (transactionID == null) {
                throw new Error('Payload database adapter did not return a transaction ID')
            }

            const transactionReq = { transactionID }

            try {
                // 3. Create 'started' log
                const startedAt = new Date().toISOString()
                const startedLog = await req.payload.create({
                    collection: 'anonymization-logs',
                    data: {
                        anonymousId,
                        request: taskInput.requestId,
                        startedAt,
                        status: 'started',
                        totalCollections: Object.keys(configuredCollections).length,
                    },
                    overrideAccess: true,
                    req: transactionReq,
                })

                // 4. Process each configured collection
                for (const [collection, collectionConfig] of Object.entries(configuredCollections)) {
                    const collectionDocuments = await req.payload.find({
                        collection: collection as CollectionSlug,
                        pagination: false,
                        overrideAccess: true,
                        req: transactionReq,
                        where: {
                            [collectionConfig.userField]: { equals: userId },
                        },
                    })

                    const maskedData = Object.fromEntries(
                        Object.entries(collectionConfig.fields).map(([fieldName, value]) => [
                            fieldName,
                            resolveValue(value, anonymousId),
                        ]),
                    )

                    const fields = Object.keys(collectionConfig.fields)
                    maskedFields[collection] = fields

                    // Capture original data before masking (only masked fields + ID)
                    originalData[collection] = collectionDocuments.docs.map((collectionDocument) => ({
                        id: String(collectionDocument.id),
                        data: Object.fromEntries(
                            fields.map((fieldName) => {
                                const fieldValue = collectionDocument[fieldName as keyof typeof collectionDocument]
                                // If field is a populated relationship object, extract just the ID
                                if (fieldValue && typeof fieldValue === 'object' && 'id' in fieldValue) {
                                    return [fieldName, fieldValue.id]
                                }
                                return [fieldName, fieldValue]
                            }),
                        ),
                    }))

                    // Apply masking updates
                    for (const collectionDocument of collectionDocuments.docs) {
                        await req.payload.update({
                            collection: collection as CollectionSlug,
                            data: maskedData,
                            id: collectionDocument.id,
                            overrideAccess: true,
                            req: transactionReq,
                        })
                        processedRecords.push({ collection, id: String(collectionDocument.id) })
                    }

                    totalDocumentsMasked += collectionDocuments.docs.length

                    collectionResults.push({
                        collection,
                        documentsMasked: collectionDocuments.docs.length,
                        fields,
                    })
                }

                // 5. Create anonymized-identities record
                const anonymizedRecord = await req.payload.create({
                    collection: 'anonymized-identities',
                    data: {
                        anonymousId,
                        originalDocId: userId,
                        originalCollection: 'users',
                        maskedAt: new Date().toISOString(),
                        maskedFields: {
                            collections: maskedFields,
                            records: processedRecords,
                        },
                        internal: true,
                    },
                    overrideAccess: true,
                    req: transactionReq,
                })

                // 6. Store metadata if enabled
                if (taskInput.metadataEnabled === true) {
                    let shouldEncrypt = false
                    let metadataEncryptionKey: string | undefined

                    if (taskInput.encryptionKey) {
                        shouldEncrypt = true
                        const databaseKeyResult = await req.payload.find({
                            collection: 'anonymization-key',
                            limit: 1,
                            overrideAccess: true,
                            req: transactionReq,
                        })

                        const databaseKey = String(databaseKeyResult.docs[0]?.keyFragment || '')

                        if (!databaseKey) {
                            throw new Error('Anonymization database key is not initialized')
                        }

                        metadataEncryptionKey = deriveMetadataKey(taskInput.encryptionKey, databaseKey)
                    }

                    await req.payload.create({
                        collection: 'anonymization-metadata',
                        data: {
                            encryptedData:
                                shouldEncrypt && metadataEncryptionKey
                                    ? encryptMetadata(
                                        { capturedAt: new Date().toISOString(), collections: originalData },
                                        metadataEncryptionKey,
                                    )
                                    : { capturedAt: new Date().toISOString(), collections: originalData },
                            identity: anonymizedRecord.id,
                        },
                        overrideAccess: true,
                        req: transactionReq,
                    })
                }

                // 7. Update the request to completed
                await req.payload.update({
                    collection: 'anonymization-requests',
                    id: taskInput.requestId,
                    data: {
                        anonymizedRecord: anonymizedRecord.id,
                        status: 'completed',
                    },
                    overrideAccess: true,
                    req: transactionReq,
                })

                // 8. Update the log to completed
                const durationMs = Date.now() - startedAtMs
                await req.payload.update({
                    collection: 'anonymization-logs',
                    id: startedLog.id,
                    data: {
                        status: 'completed',
                        durationMs,
                        collectionResults,
                    },
                    overrideAccess: true,
                    req: transactionReq,
                })

                // Commit transaction
                await req.payload.db.commitTransaction(transactionID)

                return {
                    output: {
                        anonymousId,
                        collectionsProcessed: Object.keys(configuredCollections).length,
                        totalDocumentsMasked,
                    },
                }
            } catch (error) {
                // Rollback transaction on error
                await req.payload.db.rollbackTransaction(transactionID)

                // Log the failure
                const durationMs = Date.now() - startedAtMs
                const errorMessage = error instanceof Error ? error.message : String(error)

                try {
                    await req.payload.create({
                        collection: 'anonymization-logs',
                        data: {
                            anonymousId,
                            request: taskInput.requestId,
                            startedAt: new Date(startedAtMs).toISOString(),
                            status: 'failed',
                            durationMs,
                            collectionResults,
                            errorMessage,
                        },
                        overrideAccess: true,
                    })
                } catch (logError) {
                    console.error('Failed to log anonymization error:', logError)
                }

                throw error
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Anonymization task failed: ${errorMessage}`)
        }
    },
})
