import { randomBytes } from 'node:crypto'

import type { Config } from 'payload'

import { AnonymizationRequests } from './collections/AnonymizationRequests.js'
import { AnonymizedIdentities } from './collections/AnonymizedIdentities.js'
import { AnonymizationLogs } from './collections/AnonymizationLogs.js'
import { AnonymizationKey } from './collections/AnonymizationKey.js'
import { AnonymizationMetadata } from './collections/AnonymizationMetadata.js'
import { createAnonymizeApprovedRequest } from './hooks/anonymizeApprovedRequest.js'

export type AnonymizationValue =
  | boolean
  | null
  | number
  | string
  | ((context: { anonymousId: string }) => unknown)

export type AnonymizationCollectionConfig = {
  userField: string
  fields: Record<string, AnonymizationValue>
}

export type AnonymizationMetadataConfig = {
  enabled?: boolean
  encryptionKey?: string
}

export type AnonymizerMaskingConfig = {
  collections: Record<string, AnonymizationCollectionConfig>
  metadata?: AnonymizationMetadataConfig
  disabled?: boolean
}

export const anonymizerMasking =
  (pluginOptions: AnonymizerMaskingConfig) =>
    (config: Config): Config => {
      if (Object.keys(pluginOptions.collections).length === 0) {
        throw new Error('anonymizerMasking requires at least one configured collection')
      }

      if (pluginOptions.metadata?.enabled && !pluginOptions.metadata.encryptionKey) {
        throw new Error('anonymizerMasking requires metadata.encryptionKey when metadata is enabled')
      }

      if (!pluginOptions.disabled) {
        AnonymizationRequests.hooks = {
          ...AnonymizationRequests.hooks,
          afterChange: [
            ...(AnonymizationRequests.hooks?.afterChange || []),
            createAnonymizeApprovedRequest(pluginOptions.collections, pluginOptions.metadata),
          ],
        }
      }

      if (!config.collections) config.collections = []

      config.collections.push(AnonymizationRequests, AnonymizedIdentities, AnonymizationLogs)

      if (pluginOptions.metadata?.enabled === true) {
        config.collections.push(AnonymizationKey, AnonymizationMetadata)
      }

      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        if (incomingOnInit) await incomingOnInit(payload)

        if (pluginOptions.metadata?.enabled) {
          const { totalDocs } = await payload.count({
            collection: 'anonymization-key',
          })

          if (totalDocs === 0) {
            await payload.create({
              collection: 'anonymization-key',
              data: {
                keyFragment: randomBytes(32).toString('base64'),
              },
              overrideAccess: true,
            })
          }
        }
      }

      return config
    }
