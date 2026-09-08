import { randomUUID } from 'node:crypto'

import type { CollectionAfterChangeHook, CollectionSlug } from 'payload'

import type { AnonymizationCollectionConfig, AnonymizationValue } from '../index.js'

type AnonymizationRequest = {
  id: string
  user: string | { id: string }
  status: 'pending' | 'approved' | 'completed' | 'rejected'
}

const resolveValue = (value: AnonymizationValue, anonymousId: string): unknown =>
  typeof value === 'function' ? value({ anonymousId }) : value

export const createAnonymizeApprovedRequest = (
  configuredCollections: Record<string, AnonymizationCollectionConfig>,
): CollectionAfterChangeHook<AnonymizationRequest> => async ({
  context,
  doc,
  previousDoc,
  req,
}) => {
    if (context.anonymizationInProgress || doc.status !== 'approved' || previousDoc?.status !== 'pending') {
      return doc
    }

    const anonymousId = randomUUID()
    const userId = typeof doc.user === 'string' ? doc.user : doc.user.id
    const maskedFields: Record<string, string[]> = {}
    const processedRecords: Array<{ collection: string; id: string }> = []

    for (const [collection, collectionConfig] of Object.entries(configuredCollections)) {
      const collectionDocuments = await req.payload.find({
        collection: collection as CollectionSlug,
        pagination: false,
        overrideAccess: true,
        req,
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
      maskedFields[collection] = Object.keys(collectionConfig.fields)

      for (const collectionDocument of collectionDocuments.docs) {
        await req.payload.update({
          collection: collection as CollectionSlug,
          data: maskedData,
          id: collectionDocument.id,
          overrideAccess: true,
          req,
        })
        processedRecords.push({ collection, id: String(collectionDocument.id) })
      }
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
      },
      overrideAccess: true,
      req,
    })

    await req.payload.update({
      collection: 'anonymization-requests',
      data: {
        approvedBy: req.user?.id,
        anonymizedRecord: anonymizedRecord.id,
        status: 'completed',
      },
      id: doc.id,
      overrideAccess: true,
      req,
      context: {
        ...context,
        anonymizationInProgress: true,
      },
    })

    return doc
  }