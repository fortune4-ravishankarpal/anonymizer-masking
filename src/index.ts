import type { Config } from 'payload'

import { AnonymizationRequests } from './collections/AnonymizationRequests.js'
import { AnonymizedIdentities } from './collections/AnonymizedIdentities.js'
import { AnonymizationLogs } from './collections/AnonymizationLogs.js'
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

export type AnonymizerMaskingConfig = {
  collections: Record<string, AnonymizationCollectionConfig>
  disabled?: boolean
}

export const anonymizerMasking =
  (pluginOptions: AnonymizerMaskingConfig) =>
    (config: Config): Config => {
      if (Object.keys(pluginOptions.collections).length === 0) {
        throw new Error('anonymizerMasking requires at least one configured collection')
      }

      if (!pluginOptions.disabled) {
        AnonymizationRequests.hooks = {
          ...AnonymizationRequests.hooks,
          afterChange: [
            ...(AnonymizationRequests.hooks?.afterChange || []),
            createAnonymizeApprovedRequest(pluginOptions.collections),
          ],
        }
      }

      if (!config.collections) config.collections = []

      config.collections.push(AnonymizationRequests, AnonymizedIdentities, AnonymizationLogs)

      return config
    }
