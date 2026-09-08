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

describe('Plugin integration tests', () => {
  test('anonymizes a user and related private records', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: (await payload.find({ collection: 'users', limit: 1 })).docs[0].id,
    })
    const address = await payload.create({
      collection: 'user-addresses',
      data: {
        addressLine1: '123 Example Street',
        city: 'Private City',
        postalCode: '12345',
        user: admin.id,
      },
    })
    const creditCard = await payload.create({
      collection: 'user-credit-cards',
      data: {
        cardNumber: '4111111111111111',
        cardholderName: 'Private Person',
        cvv: '123',
        expiry: '12/30',
        user: admin.id,
      },
    })
    const transaction = await payload.create({
      collection: 'transactions',
      data: {
        amount: 125.5,
        paymentMethod: 'card',
        privateNote: 'Private purchase note',
        user: admin.id,
      },
    })

    const request = await payload.create({
      collection: 'anonymization-requests',
      data: {
        requestedBy: admin.id,
        user: admin.id,
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

    const anonymizedUser = await payload.findByID({
      collection: 'users',
      id: admin.id,
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
      originalDocId: admin.id,
      maskedFields: expect.objectContaining({
        users: ['name', 'email', 'phone', 'address'],
        transactions: ['privateNote'],
      }),
    })

    const metadataRecords = await payload.find({
      collection: 'anonymization-metadata',
      where: { identity: { equals: completedRequest.anonymizedRecord as string } },
      limit: 1,
      overrideAccess: true,
    })
    expect(metadataRecords.docs).toHaveLength(1)
    expect(metadataRecords.docs[0].encryptedData).toMatchObject({
      algorithm: 'aes-256-gcm',
      authTag: expect.any(String),
      ciphertext: expect.any(String),
      iv: expect.any(String),
    })

    await expect(
      payload.find({
        collection: 'anonymization-metadata',
        where: { identity: { equals: completedRequest.anonymizedRecord as string } },
        limit: 1,
        overrideAccess: false,
        user: admin,
      }),
    ).rejects.toThrow()

    await expect(
      payload.create({
        collection: 'anonymization-metadata',
        data: {
          encryptedData: metadataRecords.docs[0].encryptedData,
          identity: completedRequest.anonymizedRecord as string,
        },
        overrideAccess: true,
      }),
    ).rejects.toThrow()
  })

  test('only admins can read anonymization requests', async () => {
    const regularUser = await payload.create({
      collection: 'users',
      data: {
        email: 'regular@payloadcms.com',
        password: 'test',
        roles: ['user'],
      },
    })
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
