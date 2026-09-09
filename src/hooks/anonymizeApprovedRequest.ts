import type { CollectionAfterChangeHook } from 'payload'

import type { AnonymizationCollectionConfig, AnonymizationMetadataConfig } from '../index.js'

type AnonymizationRequest = {
  id: string
  user: string | number | { id: string | number }
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'rejected'
}

export const createAnonymizeApprovedRequest = (
  configuredCollections: Record<string, AnonymizationCollectionConfig>,
  metadataConfig?: AnonymizationMetadataConfig,
): CollectionAfterChangeHook<AnonymizationRequest> => async ({ context, doc, previousDoc, req }) => {
  // Only trigger when status changes from pending → approved
  if (
    context.anonymizationInProgress ||
    doc.status !== 'approved' ||
    previousDoc?.status !== 'pending'
  ) {
    return doc
  }

  try {
    // Update status to 'processing' immediately to notify admin
    await req.payload.update({
      collection: 'anonymization-requests',
      id: doc.id,
      data: {
        status: 'processing',
      },
      overrideAccess: true,
      context: {
        ...context,
        anonymizationInProgress: true,
      },
    })

    // Queue the background job to perform the heavy lifting
    await req.payload.jobs.queue({
      task: 'anonymizeDataTask',
      input: {
        requestId: String(doc.id),
        encryptionKey: metadataConfig?.encryptionKey,
        metadataEnabled: metadataConfig?.enabled === true,
      },
    })

    console.log(`✓ Anonymization job queued for request ${doc.id}`)

    return doc
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`✗ Failed to queue anonymization job: ${errorMessage}`)

    // Revert status to 'pending' if job queuing fails
    try {
      await req.payload.update({
        collection: 'anonymization-requests',
        id: doc.id,
        data: {
          status: 'pending',
        },
        overrideAccess: true,
      })
    } catch (revertError) {
      console.error('Failed to revert status:', revertError)
    }

    throw error
  }
}