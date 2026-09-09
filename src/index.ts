import { randomBytes } from 'node:crypto'

import type { Config } from 'payload'

import { AnonymizationRequests } from './collections/AnonymizationRequests.js'
import { AnonymizedIdentities } from './collections/AnonymizedIdentities.js'
import { AnonymizationLogs } from './collections/AnonymizationLogs.js'
import { AnonymizationKey } from './collections/AnonymizationKey.js'
import { AnonymizationMetadata } from './collections/AnonymizationMetadata.js'
import { createAnonymizeApprovedRequest } from './hooks/anonymizeApprovedRequest.js'
import { createAnonymizeTask } from './tasks/anonymizeTask.js'

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

export type AnonymizerMaskingAutoRunConfig = {
  /**
   * The cron expression for how often queued anonymization jobs are processed.
   *
   * @default '* * * * *'
   */
  cron?: string
  /**
   * Process jobs from all queues. When `false`, only `queue` is processed.
   *
   * @default true
   */
  allQueues?: boolean
  /**
   * The queue to process when `allQueues` is `false`.
   *
   * @default 'default'
   */
  queue?: string
  /**
   * The maximum number of jobs processed per cron tick.
   *
   * @default 10
   */
  limit?: number
  /**
   * Disable automatic scheduling for tasks/workflows that declare a `schedule`.
   *
   * @default false
   */
  disableScheduling?: boolean
  /**
   * Silence the job-system console output (both info and error logs).
   *
   * @default false
   */
  silent?: boolean
}

export type AnonymizerMaskingJobsConfig = {
  /**
   * Toggle the Payload job system. When `false`, no tasks run and no cron is
   * registered. This is separate from `autoRun` (which only controls the cron).
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Control how queued anonymization jobs are auto-processed.
   *
   * - Omit or pass an object to customize the cron (defaults to running every
   *   minute and processing all queues).
   * - Pass `false` to disable the cron entirely; jobs only run when you call
   *   `payload.jobs.run()` (or the admin Jobs panel) yourself.
   *
   * @default { allQueues: true, cron: '* * * * *' }
   */
  autoRun?: AnonymizerMaskingAutoRunConfig | false
}

export type AnonymizerMaskingConfig = {
  collections: Record<string, AnonymizationCollectionConfig>
  metadata?: AnonymizationMetadataConfig
  jobs?: AnonymizerMaskingJobsConfig
  disabled?: boolean
}

const DEFAULT_AUTORUN_CRON = '* * * * *'

export const anonymizerMasking =
  (pluginOptions: AnonymizerMaskingConfig) =>
    (config: Config): Config => {
      if (Object.keys(pluginOptions.collections).length === 0) {
        throw new Error('anonymizerMasking requires at least one configured collection')
      }

      // Kill-switch: don't modify the incoming config at all when disabled
      if (pluginOptions.disabled) {
        return config
      }

      // No validation needed - encryption is optional when metadata is enabled

      AnonymizationRequests.hooks = {
        ...AnonymizationRequests.hooks,
        afterChange: [
          ...(AnonymizationRequests.hooks?.afterChange || []),
          createAnonymizeApprovedRequest(pluginOptions.collections, pluginOptions.metadata),
        ],
      }

      if (!config.collections) config.collections = []

      config.collections.push(AnonymizationRequests, AnonymizedIdentities, AnonymizationLogs)

      if (pluginOptions.metadata?.enabled === true) {
        config.collections.push(AnonymizationKey, AnonymizationMetadata)
      }

      // Register the anonymization task in the jobs queue
      if (!config.jobs) {
        config.jobs = {}
      }
      if (!config.jobs.tasks) {
        config.jobs.tasks = []
      }
      config.jobs.tasks.push(
        createAnonymizeTask(pluginOptions.collections),
      )

      // Optional toggle for the Payload job system itself
      if (typeof pluginOptions.jobs?.enabled === 'boolean') {
        config.jobs.enabled = pluginOptions.jobs.enabled
      }

      // The auto-run cron is fully configurable via the plugin options.
      // Pass `autoRun: false` to disable the cron so queued jobs only run when
      // drained manually (e.g. `payload.jobs.run()` from your own scheduler).
      if (pluginOptions.jobs?.autoRun === false) {
        delete config.jobs.autoRun
      } else {
        const autoRun = pluginOptions.jobs?.autoRun ?? {}
        config.jobs.autoRun = [
          {
            allQueues: autoRun.allQueues ?? true,
            cron: autoRun.cron ?? DEFAULT_AUTORUN_CRON,
            ...(autoRun.queue !== undefined ? { queue: autoRun.queue } : {}),
            ...(autoRun.limit !== undefined ? { limit: autoRun.limit } : {}),
            ...(autoRun.disableScheduling !== undefined
              ? { disableScheduling: autoRun.disableScheduling }
              : {}),
            ...(autoRun.silent !== undefined ? { silent: autoRun.silent } : {}),
          },
        ]
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
