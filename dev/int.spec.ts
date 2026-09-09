import { randomUUID } from 'node:crypto'

import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  if (payload) await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

const createUser = async (roles: string[], prefix: string) =>
  payload.create({
    collection: 'users',
    data: {
      address: '123 Example Street',
      email: `${prefix}-${randomUUID()}@payloadcms.com`,
      name: `${prefix} name`,
      password: 'test',
      phone: '123-456-7890',
      roles,
    },
    overrideAccess: true,
  })

describe('Plugin integration tests', () => {
  test('anonymizes a user and related private records via queued job', async () => {
    const admin = await createUser(['admin'], 'admin')
    const target = await createUser(['admin'], 'target')

    const address = await payload.create({
      collection: 'user-addresses',
      data: {
        addressLine1: '123 Example Street',
        city: 'Private City',
        postalCode: '12345',
        user: target.id,
      },
    })
    const creditCard = await payload.create({
      collection: 'user-credit-cards',
      data: {
        cardNumber: '4111111111111111',
        cardholderName: 'Private Person',
        cvv: '123',
        expiry: '12/30',
        user: target.id,
      },
    })
    const transaction = await payload.create({
      collection: 'transactions',
      data: {
        amount: 125.5,
        paymentMethod: 'card',
        privateNote: 'Private purchase note',
        user: target.id,
      },
    })

    const request = await payload.create({
      collection: 'anonymization-requests',
      data: {
        requestedBy: admin.id,
        user: target.id,
      },
      overrideAccess: false,
      user: admin,
    })

    await payload.update({
      collection: 'anonymization-requests',
      data: { status: 'approved' },
      id: request.id,
      overrideAccess: false,
      user: admin,
    })

    // The afterChange hook queues `anonymizeDataTask` and sets the request to
    // 'processing'. In the running app the `jobs.autoRun` cron drains the queue
    // every minute. In tests we drain it on demand via the Local API.
    const processingRequest = await payload.findByID({
      collection: 'anonymization-requests',
      id: request.id,
      depth: 0,
    })
    expect(processingRequest.status).toBe('processing')

    await payload.jobs.run({ allQueues: true })

    const anonymizedUser = await payload.findByID({
      collection: 'users',
      id: target.id,
    })
    const anonymizedAddress = await payload.findByID({
      collection: 'user-addresses',
      id: address.id,
    })
    const anonymizedCreditCard = await payload.findByID({
      collection: 'user-credit-cards',
      id: creditCard.id,
    })
    const preservedTransaction = await payload.findByID({
      collection: 'transactions',
      id: transaction.id,
    })
    const completedRequest = await payload.findByID({
      collection: 'anonymization-requests',
      id: request.id,
      depth: 0,
    })

    expect(anonymizedUser).toMatchObject({
      address: null,
      email: expect.stringMatching(/^anon-[0-9a-f-]+@anonymized\.local$/),
      name: expect.stringMatching(/^Anonymous User [0-9a-f]{8}$/),
      phone: null,
    })
    expect(anonymizedAddress).toMatchObject({
      addressLine1: null,
      city: null,
      postalCode: null,
    })
    expect(anonymizedCreditCard).toMatchObject({
      cardNumber: '0000000000000000',
      cardholderName: 'Anonymous User',
      cvv: null,
      expiry: null,
    })
    expect(preservedTransaction).toMatchObject({
      amount: 125.5,
      paymentMethod: 'card',
      privateNote: null,
    })
    expect(completedRequest.status).toBe('completed')
    expect(completedRequest.approvedBy).toBe(admin.id)
    expect(completedRequest.anonymizedRecord).toBeTruthy()

    const { docs: logs } = await payload.find({
      collection: 'anonymization-logs',
      where: { request: { equals: request.id } },
      depth: 0,
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      status: 'completed',
      totalCollections: 4,
      totalDocuments: 4,
    })
    expect(logs[0].durationMs).toEqual(expect.any(Number))
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(logs[0].collectionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'transactions', documentsMasked: 1 }),
        expect.objectContaining({ collection: 'user-credit-cards', documentsMasked: 1 }),
      ]),
    )

    const identity = await payload.findByID({
      collection: 'anonymized-identities',
      id: completedRequest.anonymizedRecord as string,
    })
    expect(identity).toMatchObject({
      originalCollection: 'users',
      originalDocId: String(target.id),
    })
    expect(
      ((identity.maskedFields as { collections: { users: string[] } }).collections).users,
    ).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'address']))

    const metadataRecords = await payload.find({
      collection: 'anonymization-metadata',
      where: { identity: { equals: completedRequest.anonymizedRecord as string } },
      limit: 1,
      overrideAccess: true,
    })
    // Metadata is stored for the runtime config `metadata: { enabled: true }`.
    // Note: no `encryptionKey` is configured in the dev setup, so it is stored
    // as plaintext `{ capturedAt, collections }`.
    expect(metadataRecords.docs).toHaveLength(1)
    expect(metadataRecords.docs[0].encryptedData).toMatchObject({
      capturedAt: expect.any(String),
      collections: expect.any(Object),
    })
  })

  test('only admins can read anonymization requests', async () => {
    const regularUser = await createUser(['user'], 'regular')
    const request = await payload.create({
      collection: 'anonymization-requests',
      data: {
        requestedBy: regularUser.id,
        user: regularUser.id,
      },
      overrideAccess: true,
    })

    await expect(
      payload.find({
        collection: 'anonymization-requests',
        overrideAccess: false,
        user: regularUser,
      }),
    ).rejects.toThrow()
    await expect(
      payload.update({
        collection: 'anonymization-requests',
        data: { status: 'rejected' },
        id: request.id,
        overrideAccess: false,
        user: regularUser,
      }),
    ).rejects.toThrow()
  })
})