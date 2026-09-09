import type { CollectionConfig } from 'payload'

import { adminOnly, authenticated } from '../access/adminOnly.js'

export const AnonymizationRequests: CollectionConfig = {
    slug: 'anonymization-requests',
    admin: {
        defaultColumns: ['user', 'status', 'createdAt'],
        useAsTitle: 'status',
    },
    access: {
        admin: adminOnly,
        create: authenticated,
        delete: adminOnly,
        read: adminOnly,
        update: adminOnly,
    },
    fields: [
        {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            required: true,
        },
        {
            name: 'requestedBy',
            type: 'relationship',
            relationTo: 'users',
        },
        {
            name: 'status',
            type: 'select',
            defaultValue: 'pending',
            options: ['pending', 'approved', 'processing', 'completed', 'rejected'],
            required: true,
        },
        {
            name: 'approvedBy',
            type: 'relationship',
            relationTo: 'users',
        },
        {
            name: 'anonymizedRecord',
            type: 'relationship',
            relationTo: 'anonymized-identities',
        },
    ],
    hooks: {
        afterChange: [],
    },
}
