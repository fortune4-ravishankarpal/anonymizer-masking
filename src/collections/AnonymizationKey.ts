import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly.js'

export const AnonymizationKey: CollectionConfig = {
    slug: 'anonymization-key',
    admin: {
        hidden: true,
    },
    access: {
        admin: adminOnly,
        create: () => false,
        delete: () => false,
        read: () => false,
        update: () => false,
    },
    fields: [
        {
            name: 'keyFragment',
            type: 'text',
            required: true,
            unique: true,
            admin: {
                hidden: true,
            },
            access: {
                create: () => false,
                read: () => false,
                update: () => false,
            },
        },
    ],
}
