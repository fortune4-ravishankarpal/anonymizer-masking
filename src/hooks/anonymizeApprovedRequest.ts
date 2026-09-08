import { randomUUID } from 'node:crypto'

import type { CollectionAfterChangeHook, CollectionSlug } from 'payload'

import type {
  AnonymizationCollectionConfig,
  AnonymizationMetadataConfig,
  AnonymizationValue,
} from '../index.js'
import { deriveMetadataKey, encryptMetadata } from '../utils/encryptMetadata.js'

type AnonymizationRequest = {
  id: string
  user: string | number | { id: string | number }
  status: 'pending' | 'approved' | 'completed' | 'rejected'
}

const resolveValue = (value: AnonymizationValue, anonymousId: string): unknown =>
  typeof value === 'function' ? value({ anonymousId }) : value

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createAnonymizeApprovedRequest = (
  configuredCollections: Record<string, AnonymizationCollectionConfig>,
  metadataConfig?: AnonymizationMetadataConfig,
): CollectionAfterChangeHook<AnonymizationRequest> => async ({
  context,
  doc,
  previousDoc,
  req,
}) => {
    if (context.anonymizationInProgress || doc.status !== 'approved' || previousDoc?.status !== 'pending') {

      return doc
    }

    const startedAt = new Date().toISOString()
    const startedAtMs = Date.now()
    const anonymousId = randomUUID()
    const userId = typeof doc.user === 'object' ? doc.user.id : doc.user
    const maskedFields: Record<string, string[]> = {}
    const processedRecords: Array<{ collection: string; id: string }> = []
    const collectionResults: Array<{ collection: string; documentsMasked: number; fields: string[] }> = []
    const originalData: Record<string, Array<{ id: string; data: unknown }>> = {}
    let transactionID: string | number | null | undefined
    let ownsTransaction = false
    let logId: string | number | undefined

    try {
      const requestTransactionID = req.transactionID instanceof Promise
        ? await req.transactionID
        : req.transactionID

      if (requestTransactionID != null) {
        transactionID = requestTransactionID
      } else {
        transactionID = await req.payload.db.beginTransaction()
        ownsTransaction = true
      }

      if (transactionID == null) {
        throw new Error('Payload database adapter did not return a transaction ID')
      }

      const transactionReq = requestTransactionID != null ? req : { transactionID }
      const metadataEnabled = metadataConfig?.enabled === true
      let metadataEncryptionKey: string | undefined

      if (metadataEnabled) {
        const databaseKeyResult = await req.payload.find({
          collection: 'anonymization-key',
          limit: 1,
          overrideAccess: true,
          req: transactionReq,
        })
        const databaseKey = String(databaseKeyResult.docs[0]?.keyFragment || '')

        if (!databaseKey || !metadataConfig.encryptionKey) {
          throw new Error('Anonymization metadata encryption key is not initialized')
        }

        metadataEncryptionKey = deriveMetadataKey(metadataConfig.encryptionKey, databaseKey)
      }
      const startedLog = await req.payload.create({
        collection: 'anonymization-logs',
        data: {
          anonymousId,
          request: doc.id,
          startedAt,
          status: 'started',
          totalCollections: Object.keys(configuredCollections).length,
        },
        overrideAccess: true,
        req: transactionReq,
      })
      logId = startedLog.id

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
        originalData[collection] = collectionDocuments.docs.map((collectionDocument) => ({
          data: collectionDocument,
          id: String(collectionDocument.id),
        }))

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

        collectionResults.push({
          collection,
          documentsMasked: collectionDocuments.docs.length,
          fields,
        })
      }

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

      if (metadataEnabled && metadataEncryptionKey) {
        await req.payload.create({
          collection: 'anonymization-metadata',
          data: {
            encryptedData: encryptMetadata(
              { capturedAt: new Date().toISOString(), collections: originalData },
              metadataEncryptionKey,
            ),
            identity: anonymizedRecord.id,
          },
          overrideAccess: true,
          req: transactionReq,
        })
      }

      await req.payload.update({
        collection: 'anonymization-requests',
        data: {
          approvedBy: req.user?.id,
          anonymizedRecord: anonymizedRecord.id,
          status: 'completed',
        },
        id: doc.id,
        overrideAccess: true,
        req: transactionReq,
        context: {
          ...context,
          anonymizationInProgress: true,
        },
      })

      await req.payload.update({
        collection: 'anonymization-logs',
        data: {
          collectionResults,
          completedAt: new Date().toISOString(),
          status: 'completed',
          totalDocuments: processedRecords.length,
          durationMs: Date.now() - startedAtMs,
        },
        id: logId,
        overrideAccess: true,
        req: transactionReq,
      })

      if (ownsTransaction) {
        await req.payload.db.commitTransaction(transactionID)
      }

      return doc
    } catch (error) {
      const errorMessage = getErrorMessage(error)

      try {
        if (ownsTransaction && transactionID != null) {
          await req.payload.db.rollbackTransaction(transactionID)
        }

        await req.payload.create({
          collection: 'anonymization-logs',
          data: {
            anonymousId,
            collectionResults,
            completedAt: new Date().toISOString(),
            errorMessage,
            request: doc.id,
            startedAt,
            status: 'failed',
            totalCollections: Object.keys(configuredCollections).length,
            totalDocuments: processedRecords.length,
            durationMs: Date.now() - startedAtMs,
          },
          overrideAccess: true,
        })
      } catch (logError) {
        req.payload.logger.error(`Unable to persist anonymization failure: ${getErrorMessage(logError)}`)
      }

      throw error
    }
  }