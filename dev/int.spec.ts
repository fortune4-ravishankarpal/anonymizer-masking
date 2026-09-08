import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('Plugin integration tests', () => {
  test('anonymizes an approved customer request', async () => {
    const admin = await payload.findByID({
      collection: 'users',
      id: (await payload.find({ collection: 'users', limit: 1 })).docs[0].id,
    })
    const customer = await payload.create({
      collection: 'customers',
      data: {
        address: '123 Example Street',
        email: 'person@example.com',
        name: 'Private Person',
        phone: '555-0100',
      },
    })

    const request = await payload.create({
      collection: 'anonymization-requests',
      data: {
        requestedBy: admin.id,
        targetCollection: 'customers',
        targetDocId: customer.id,
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

    const anonymizedCustomer = await payload.findByID({
      collection: 'customers',
      id: customer.id,
    })
    const completedRequest = await payload.findByID({
      collection: 'anonymization-requests',
      id: request.id,
      depth: 0,
    })

    expect(anonymizedCustomer).toMatchObject({
      address: null,
      email: expect.stringMatching(/^anon-[0-9a-f-]+@anonymized\.local$/),
      isAnonymized: true,
      name: 'Anonymized User',
      phone: null,
    })
    expect(completedRequest.status).toBe('completed')
    expect(completedRequest.approvedBy).toBe(admin.id)
    expect(completedRequest.anonymizedRecord).toBeTruthy()

    const identity = await payload.findByID({
      collection: 'anonymized-identities',
      id: completedRequest.anonymizedRecord as string,
    })
    expect(identity).toMatchObject({
      originalCollection: 'customers',
      originalDocId: customer.id,
      maskedFields: ['name', 'email', 'phone', 'address', 'isAnonymized'],
    })
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
        targetCollection: 'customers',
        targetDocId: 'not-a-real-customer',
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
