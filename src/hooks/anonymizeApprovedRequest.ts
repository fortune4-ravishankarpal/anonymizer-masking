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
    // Update status to 'processing' immediately to notify admin.
    // NOTE: We MUST pass `req` so this nested update joins the SAME database
    // transaction as the outer update. Without it Payload starts a new
    // transaction on another pooled connection, which then blocks forever
    // on the row-lock held by the outer (uncommitted) UPDATE.
    await req.payload.update({
      collection: 'anonymization-requests',
      id: doc.id,
      data: {
        approvedBy: req.user?.id,
        status: 'processing',
      },
      overrideAccess: true,
      req,
      context: {
        ...context,
        anonymizationInProgress: true,
      },
    })

    // Queue the background job to perform the heavy lifting
    let job = await req.payload.jobs.queue({
      task: 'anonymizeDataTask',
      input: {
        requestId: String(doc.id),
        encryptionKey: metadataConfig?.encryptionKey,
        metadataEnabled: metadataConfig?.enabled === true,
      },
      req,
    })

    console.log(`✓ Anonymization job queued for request ${doc.id}`)
    if (process.env.NODE_ENV === "development") {
      await req.payload.jobs.runByID({
        id: job.id,
        req,
      })
    }
    return doc
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`✗ Failed to queue anonymization job: ${errorMessage}`)

    // Revert status to 'pending' if job queuing fails.
    // Joining the same transaction means these changes are rolled back with the
    // outer transaction (keeping the previously committed 'pending' state).
    try {
      await req.payload.update({
        collection: 'anonymization-requests',
        id: doc.id,
        data: {
          status: 'pending',
        },
        overrideAccess: true,
        req,
      })
    } catch (revertError) {
      console.error('Failed to revert status:', revertError)
    }

    throw error
  }
}