import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly.js'

export const AnonymizationLogs: CollectionConfig = {
    slug: 'anonymization-logs',
    admin: {
        defaultColumns: ['request', 'status', 'totalCollections', 'totalDocuments', 'startedAt'],
        useAsTitle: 'status',
    },
    access: {
        admin: adminOnly,
        create: adminOnly,
        delete: adminOnly,
        read: adminOnly,
        update: adminOnly,
    },
    fields: [
        {
            name: 'request',
            type: 'relationship',
            relationTo: 'anonymization-requests',
            required: true,
        },
        {
            name: 'status',
            type: 'select',
            options: ['started', 'completed', 'failed'],
            required: true,
        },
        {
            name: 'anonymousId',
            type: 'text',
        },
        {
            name: 'startedAt',
            type: 'date',
            required: true,
        },
        {
            name: 'completedAt',
            type: 'date',
        },
        {
            name: 'durationMs',
            type: 'number',
        },
        {
            name: 'totalCollections',
            type: 'number',
            defaultValue: 0,
        },
        {
            name: 'totalDocuments',
            type: 'number',
            defaultValue: 0,
        },
        {
            name: 'collectionResults',
            type: 'json',
        },
        {
            name: 'errorMessage',
            type: 'textarea',
        },
    ],
}
