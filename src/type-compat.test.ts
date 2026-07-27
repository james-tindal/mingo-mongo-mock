import { describe, expectTypeOf, test } from 'vitest'
import type { Collection, ObjectId, OptionalId, WithId } from 'mongodb'
import { MockMongoDb, type MockCollection } from './index'


interface UserDoc {
  _id: ObjectId
  email: string
  name: string
  active?: boolean
}

describe('mongodb driver type compatibility', () => {
  test('Collection matches mongodb', () => {
    expectTypeOf<MockCollection>().toMatchTypeOf<Collection>()
  })

  test('collection exposes the mongodb driver methods this library implements', () => {
    type Expected = Pick<Collection<UserDoc>,
      | 'find'
      | 'findOne'
      | 'aggregate'
      | 'insertOne'
      | 'insertMany'
      | 'updateOne'
      | 'updateMany'
      | 'replaceOne'
      | 'findOneAndUpdate'
      | 'deleteOne'
      | 'deleteMany'
      | 'countDocuments'
      | 'distinct'
      | 'createIndex'
    >

    expectTypeOf<MockCollection<UserDoc>>().toMatchTypeOf<Expected>()
  })

  test('typed collections accept normal mongodb document types without index signatures', () => {
    const db = new MockMongoDb()
    const users = db.collection<UserDoc>('users')

    expectTypeOf(users).toEqualTypeOf<MockCollection<UserDoc>>()
    expectTypeOf(users.findOne({ email: 'alice@example.com' })).resolves.toMatchTypeOf<WithId<UserDoc> | null>()
    expectTypeOf(users.insertOne({ email: 'alice@example.com', name: 'Alice' } satisfies OptionalId<UserDoc>)).resolves.toHaveProperty('insertedId')
  })
})
