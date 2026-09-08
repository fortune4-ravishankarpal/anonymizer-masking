import { postgresAdapter } from '@payloadcms/db-postgres'

import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { anonymizerMasking } from 'anonymizer-masking'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}


export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'users',
      auth: true,
      fields: [
        { name: 'name', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'address', type: 'text' },
        {
          name: 'roles',
          type: 'select',
          hasMany: true,
          options: ['admin', 'user'],
          defaultValue: ['user'],
          saveToJWT: true,
        },
      ],
    },
    {
      slug: 'user-addresses',
      fields: [
        { name: 'user', type: 'relationship', relationTo: 'users', required: true },
        { name: 'addressLine1', type: 'text' },
        { name: 'city', type: 'text' },
        { name: 'postalCode', type: 'text' },
      ],
    },
    {
      slug: 'user-credit-cards',
      fields: [
        { name: 'user', type: 'relationship', relationTo: 'users', required: true },
        { name: 'cardholderName', type: 'text' },
        { name: 'cardNumber', type: 'text' },
        { name: 'expiry', type: 'text' },
        { name: 'cvv', type: 'text' },
      ],
    },
    {
      slug: 'transactions',
      fields: [
        { name: 'user', type: 'relationship', relationTo: 'users', required: true },
        { name: 'paymentMethod', type: 'text' },
        { name: 'amount', type: 'number' },
        { name: 'privateNote', type: 'text' },
      ],
    },
    {
      slug: 'posts',
      fields: [],
    },
    {
      slug: 'media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
    },
  ],
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
    },
  }),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  onInit: async (payload) => {
    await seed(payload)
  },
  plugins: [
    anonymizerMasking({
      metadata: {
        enabled: true,
        encryptionKey:
          process.env.ANONYMIZER_METADATA_KEY ||
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      collections: {
        users: {
          userField: 'id',
          fields: {
            address: null,
            email: ({ anonymousId }) => `anon-${anonymousId}@anonymized.local`,
            name: ({ anonymousId }) => `Anonymous User ${anonymousId.slice(0, 8)}`,
            phone: null,
          },
        },
        'user-addresses': {
          userField: 'user',
          fields: {
            addressLine1: null,
            city: null,
            postalCode: null,
          },
        },
        'user-credit-cards': {
          userField: 'user',
          fields: {
            cardNumber: '0000000000000000',
            cardholderName: 'Anonymous User',
            cvv: null,
            expiry: null,
          },
        },
        transactions: {
          userField: 'user',
          fields: {
            privateNote: null,
          },
        },
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})


