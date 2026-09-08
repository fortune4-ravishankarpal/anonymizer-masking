import { randomUUID } from 'node:crypto'

import type { CollectionAfterChangeHook, CollectionSlug } from 'payload'

import type { AnonymizationCollectionConfig, AnonymizationValue } from '../index.js'

type AnonymizationRequest = {
  id: string
  targetCollection: string
  targetDocId: string
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

    const collectionConfig = configuredCollections[doc.targetCollection]

    if (!collectionConfig) {
      throw new Error(`No anonymization configuration found for ${doc.targetCollection}`)
    }

    const anonymousId = randomUUID()
    const maskedFields = Object.keys(collectionConfig.fields)
    const maskedData = Object.fromEntries(
      Object.entries(collectionConfig.fields).map(([fieldName, value]) => [
        fieldName,
        resolveValue(value, anonymousId),
      ]),
    )

    const anonymizedRecord = await req.payload.create({
      collection: 'anonymized-identities',
      data: {
        anonymousId,
        originalDocId: doc.targetDocId,
        originalCollection: doc.targetCollection,
        maskedAt: new Date().toISOString(),
        maskedFields,
      },
      overrideAccess: true,
      req,
    })

    await req.payload.update({
      collection: doc.targetCollection as CollectionSlug,
      data: maskedData,
      id: doc.targetDocId,
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