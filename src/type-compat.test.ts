import { describe, expectTypeOf, test } from 'vitest'
import type { Collection, Db, ObjectId, OptionalId, WithId } from 'mongodb'
import { createMingoMongoDb, type MingoMongoCollection, type MingoMongoDb } from './index'

interface UserDoc {
  _id: ObjectId
  email: string
  name: string
  active?: boolean
}

describe('mongodb driver type compatibility', () => {
  test('database exposes a mongodb-like collection method shape', () => {
    expectTypeOf<MingoMongoDb>().toMatchTypeOf<Pick<Db, 'collection'>>()
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

    expectTypeOf<MingoMongoCollection<UserDoc>>().toMatchTypeOf<Expected>()
  })

  test('typed collections accept normal mongodb document types without index signatures', () => {
    const db = createMingoMongoDb()
    const users = db.collection<UserDoc>('users')

    expectTypeOf(users).toEqualTypeOf<MingoMongoCollection<UserDoc>>()
    expectTypeOf(users.findOne({ email: 'alice@example.com' })).resolves.toEqualTypeOf<WithId<UserDoc> | null>()
    expectTypeOf(users.insertOne({ email: 'alice@example.com', name: 'Alice' } satisfies OptionalId<UserDoc>)).resolves.toHaveProperty('insertedId')
  })
})
