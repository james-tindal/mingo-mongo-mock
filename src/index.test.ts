import { describe, expect, test } from 'vitest'
import { createMingoMongoDb } from './index'

describe('mingo mongo mock', () => {
  test('finds documents with mongo query syntax', async () => {
    const db = createMingoMongoDb({
      users: [
        { _id: 'alice', name: 'Alice', profile: { age: 30 }, tags: ['admin'] },
        { _id: 'bob', name: 'Bob', profile: { age: 17 }, tags: [] },
      ],
    })

    const users = await db.collection('users')
      .find({ 'profile.age': { $gte: 18 }, tags: 'admin' })
      .toArray()

    expect(users.map(user => user.name)).toEqual(['Alice'])
  })

  test('supports findOne and cursor sort/skip/limit', async () => {
    const db = createMingoMongoDb({
      users: [
        { _id: 1, name: 'Alice', age: 30 },
        { _id: 2, name: 'Bob', age: 40 },
        { _id: 3, name: 'Carol', age: 20 },
      ],
    })

    await expect(db.collection('users').findOne({ name: 'Bob' }))
      .resolves.toMatchObject({ _id: 2 })

    const users = await db.collection('users')
      .find()
      .sort({ age: -1 })
      .skip(1)
      .limit(1)
      .toArray()

    expect(users).toMatchObject([{ name: 'Alice' }])
  })

  test('runs aggregate pipelines with lookup across named collections', async () => {
    const db = createMingoMongoDb({
      users: [
        { _id: 'u1', name: 'Alice' },
        { _id: 'u2', name: 'Bob' },
      ],
      matches: [
        { _id: 'm1', userIds: ['u1', 'u2'] },
      ],
    })

    const matches = await db.collection('matches').aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userIds',
          foreignField: '_id',
          as: 'users',
        },
      },
    ]).toArray()

    expect(matches).toMatchObject([
      { _id: 'm1', users: [{ name: 'Alice' }, { name: 'Bob' }] },
    ])
  })

  test('delegates updates to mingo, including positional updates', async () => {
    const db = createMingoMongoDb({
      matches: [
        {
          _id: 'm1',
          invites: [
            { userId: 'u1', status: 'pending' },
            { userId: 'u2', status: 'pending' },
          ],
        },
      ],
    })

    const result = await db.collection('matches').updateOne(
      { _id: 'm1', invites: { $elemMatch: { userId: 'u2', status: 'pending' } } },
      { $set: { 'invites.$.status': 'declined' } },
    )

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })
    expect(db.getCollectionData('matches')).toMatchObject([
      {
        invites: [
          { userId: 'u1', status: 'pending' },
          { userId: 'u2', status: 'declined' },
        ],
      },
    ])
  })

  test('inserts, deletes, and resets collection data', async () => {
    const db = createMingoMongoDb()
    const users = db.collection('users')

    await users.insertMany([{ _id: 1, name: 'Alice' }, { _id: 2, name: 'Bob' }])
    await expect(users.deleteOne({ name: 'Alice' })).resolves.toEqual({ acknowledged: true, deletedCount: 1 })
    expect(await users.find().toArray()).toMatchObject([{ name: 'Bob' }])

    db.reset({ users: [{ _id: 3, name: 'Carol' }] })
    expect(await users.find().toArray()).toMatchObject([{ name: 'Carol' }])
  })
})
