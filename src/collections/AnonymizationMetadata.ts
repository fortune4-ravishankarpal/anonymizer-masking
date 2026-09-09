import type { CollectionConfig } from 'payload'
export const AnonymizationMetadata: CollectionConfig = {
    slug: 'anonymization-metadata',
    admin: {
        hidden: true,
    },
    access: {
        admin: () => false,
        create: () => false,
        delete: () => false,
        update: () => false,
    },
    fields: [
        {
            name: 'identity',
            type: 'relationship',
            relationTo: 'anonymized-identities',
            required: true,
            unique: true,
        },
        {
            name: 'encryptedData',
            type: 'json',
            required: true,
        },
    ],
}