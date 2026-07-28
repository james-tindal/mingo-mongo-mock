import { describe, expectTypeOf, test } from 'vitest'
import type { ObjectId, OptionalId, WithId } from 'mongodb'
import { MockMongoDb, type MockCollection } from './index'


interface UserDoc {
  _id: ObjectId
  email: string
  name: string
  active?: boolean
}

describe('mongodb driver type compatibility', () => {
  test('typed collections accept normal mongodb document types without index signatures', () => {
    const db = new MockMongoDb()
    const users = db.collection<UserDoc>('users')

    expectTypeOf(users).toEqualTypeOf<MockCollection<UserDoc>>()
    expectTypeOf(users.findOne({ email: 'alice@example.com' })).resolves.toMatchTypeOf<WithId<UserDoc> | null>()
    expectTypeOf(users.insertOne({ email: 'alice@example.com', name: 'Alice' } satisfies OptionalId<UserDoc>)).resolves.toHaveProperty('insertedId')
  })
})
