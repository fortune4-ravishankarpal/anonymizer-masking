import type { CollectionConfig } from 'payload'

export const AnonymizedIdentities: CollectionConfig = {
  slug: 'anonymized-identities',
  admin: {
    useAsTitle: 'anonymousId',
  },
  fields: [
    {
      name: 'anonymousId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'originalDocId',
      type: 'text',
      required: true,
    },
    {
      name: 'originalCollection',
      type: 'text',
      required: true,
    },
    {
      name: 'maskedAt',
      type: 'date',
    },
    {
      name: 'maskedFields',
      type: 'json',
    },
  ],
}