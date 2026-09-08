import type { Config } from 'payload'

import { AnonymizationRequests } from './collections/AnonymizationRequests.js'
import { AnonymizedIdentities } from './collections/AnonymizedIdentities.js'
import { createAnonymizeApprovedRequest } from './hooks/anonymizeApprovedRequest.js'

export type AnonymizationValue =
  | boolean
  | null
  | number
  | string
  | ((context: { anonymousId: string }) => unknown)

export type AnonymizationCollectionConfig = {
  fields: Record<string, AnonymizationValue>
}

export type AnonymizerMaskingConfig = {
  collections: Record<string, AnonymizationCollectionConfig>
  disabled?: boolean
}

export const anonymizerMasking =
  (pluginOptions: AnonymizerMaskingConfig) =>
    (config: Config): Config => {
      const configuredCollections = Object.keys(pluginOptions.collections)

      if (configuredCollections.length === 0) {
        throw new Error('anonymizerMasking requires at least one configured collection')
      }

      config.collections = [
        ...(config.collections || []),
        AnonymizationRequests,
        AnonymizedIdentities,
      ]

      AnonymizationRequests.fields = AnonymizationRequests.fields.map((field) => {
        if (field.name !== 'targetCollection' || field.type !== 'select') return field

        return { ...field, options: configuredCollections }
      })

      if (pluginOptions.disabled) return config

      AnonymizationRequests.hooks = {
        ...AnonymizationRequests.hooks,
        afterChange: [createAnonymizeApprovedRequest(pluginOptions.collections)],
      }

      return config
    }
