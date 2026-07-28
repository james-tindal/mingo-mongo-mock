import { describe, expect, test } from 'vitest'
import { MockMongoDb } from '.'

function mockDb(data: Record<string, object[]>) {
  const db = new MockMongoDb()
  for (const [name, documents] of Object.entries(data))
    db.setCollectionData(name, documents)
  return db
}

describe('mingo mongo mock', () => {
  test('finds documents with mongo query syntax', async () => {
    const db = mockDb({
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
    const db = mockDb({
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
    const db = mockDb({
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
    const db = mockDb({
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

  test('inserts, deletes, and sets collection data', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    await users.insertMany([{ _id: 1, name: 'Alice' }, { _id: 2, name: 'Bob' }])
    await expect(users.deleteOne({ name: 'Alice' })).resolves.toEqual({ acknowledged: true, deletedCount: 1 })
    expect(await users.find().toArray()).toMatchObject([{ name: 'Bob' }])

    db.setCollectionData('users', [{ _id: 3, name: 'Carol' }])
    expect(await users.find().toArray()).toMatchObject([{ name: 'Carol' }])
  })

  test('resetMock clears all collection data and indexes', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    await users.createIndex({ email: 1 }, { unique: true })
    await users.insertOne({ _id: 1, email: 'alice@example.com' })

    db.resetMock()
    expect(await users.find().toArray()).toEqual([])

    await users.insertOne({ _id: 2, email: 'alice@example.com' })
    await expect(users.insertOne({ _id: 3, email: 'alice@example.com' })).resolves.toMatchObject({ acknowledged: true })
  })

  test('generates an _id when insertOne receives a document without one', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    const result = await users.insertOne({ name: 'Alice' })

    expect(result.insertedId).toBeDefined()
    expect(await users.findOne({ name: 'Alice' })).toMatchObject({ _id: result.insertedId })
  })

  test('supports updateOne upsert', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    const result = await users.updateOne(
      { email: 'alice@example.com' },
      { $set: { name: 'Alice' } },
      { upsert: true },
    )

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })
    expect(await users.findOne({ email: 'alice@example.com' })).toMatchObject({ name: 'Alice' })
  })

  test('supports replaceOne', async () => {
    const db = mockDb({
      users: [{ _id: 1, name: 'Alice', stale: true }],
    })
    const users = db.collection('users')

    const result = await users.replaceOne({ _id: 1 }, { _id: 1, name: 'Alice Updated' })

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })
    expect(await users.findOne({ _id: 1 })).toEqual({ _id: 1, name: 'Alice Updated' })
  })

  test('supports findOneAndUpdate', async () => {
    const db = mockDb({
      users: [{ _id: 1, name: 'Alice', count: 0 }],
    })
    const users = db.collection('users')

    const result = await users.findOneAndUpdate(
      { _id: 1 },
      { $inc: { count: 1 } },
      { returnDocument: 'after' },
    )

    expect(result).toMatchObject({ ok: 1, value: { _id: 1, name: 'Alice', count: 1 } })
  })

  test('supports countDocuments', async () => {
    const db = mockDb({
      users: [
        { _id: 1, active: true },
        { _id: 2, active: false },
        { _id: 3, active: true },
      ],
    })
    const users = db.collection('users')

    await expect(users.countDocuments({ active: true })).resolves.toBe(2)
  })

  test('supports distinct', async () => {
    const db = mockDb({
      users: [
        { _id: 1, role: 'admin', active: true },
        { _id: 2, role: 'admin', active: false },
        { _id: 3, role: 'member', active: true },
      ],
    })
    const users = db.collection('users')

    await expect(users.distinct('role', { active: true })).resolves.toEqual(['admin', 'member'])
  })

  test('supports async cursor iteration', async () => {
    const db = mockDb({
      users: [{ _id: 1 }, { _id: 2 }],
    })

    const ids: unknown[] = []
    for await (const user of db.collection('users').find())
      ids.push(user._id)

    expect(ids).toEqual([1, 2])
  })

  test('enforces unique indexes', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    await users.createIndex({ email: 1 }, { unique: true })
    await users.insertOne({ _id: 1, email: 'alice@example.com' })

    await expect(users.insertOne({ _id: 2, email: 'alice@example.com' })).rejects.toThrow()
  })

  test('returns mongo-style update result fields only', async () => {
    const db = mockDb({
      users: [{ _id: 1, name: 'Alice' }],
    })

    const result = await db.collection('users').updateOne(
      { _id: 1 },
      { $set: { name: 'Alice Updated' } },
    )

    expect(Object.keys(result).sort()).toEqual(['acknowledged', 'matchedCount', 'modifiedCount'])
  })

  test('supports projection through find options', async () => {
    const db = mockDb({
      users: [{ _id: 1, name: 'Alice', password: 'secret' }],
    })

    await expect(db.collection('users').findOne(
      { _id: 1 },
      { projection: { password: 0 } },
    )).resolves.toEqual({ _id: 1, name: 'Alice' })
  })

  test('supports find options for sort, skip, limit, and projection', async () => {
    const db = mockDb({
      users: [
        { _id: 1, name: 'Alice', age: 30, password: 'a' },
        { _id: 2, name: 'Bob', age: 40, password: 'b' },
        { _id: 3, name: 'Carol', age: 20, password: 'c' },
      ],
    })

    await expect(db.collection('users').find(
      {},
      { sort: { age: -1 }, skip: 1, limit: 1, projection: { password: 0 } },
    ).toArray()).resolves.toEqual([{ _id: 1, name: 'Alice', age: 30 }])
  })

  test('supports findOne sort and projection options', async () => {
    const db = mockDb({
      users: [
        { _id: 1, name: 'Alice', age: 30, password: 'a' },
        { _id: 2, name: 'Bob', age: 40, password: 'b' },
      ],
    })

    await expect(db.collection('users').findOne(
      {},
      { sort: { age: -1 }, projection: { password: 0 } },
    )).resolves.toEqual({ _id: 2, name: 'Bob', age: 40 })
  })

  test('supports replaceOne upsert', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    const result = await users.replaceOne(
      { email: 'alice@example.com' },
      { email: 'alice@example.com', name: 'Alice' },
      { upsert: true },
    )

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 })
    expect(await users.findOne({ email: 'alice@example.com' })).toMatchObject({ name: 'Alice' })
  })

  test('supports findOneAndUpdate before/after returnDocument, projection, and upsert options', async () => {
    const db = mockDb({
      users: [{ _id: 1, name: 'Alice', count: 0, password: 'secret' }],
    })
    const users = db.collection('users')

    await expect(users.findOneAndUpdate(
      { _id: 1 },
      { $inc: { count: 1 } },
      { returnDocument: 'before', projection: { password: 0 } },
    )).resolves.toMatchObject({ ok: 1, value: { _id: 1, name: 'Alice', count: 0 } })

    await expect(users.findOneAndUpdate(
      { email: 'bob@example.com' },
      { $set: { name: 'Bob' } },
      { returnDocument: 'after', upsert: true },
    )).resolves.toMatchObject({ ok: 1, value: { email: 'bob@example.com', name: 'Bob' } })
  })

  test('passes update options through for arrayFilters and sort', async () => {
    const db = mockDb({
      users: [
        { _id: 1, priority: 1, items: [{ status: 'pending' }, { status: 'done' }] },
        { _id: 2, priority: 2, items: [{ status: 'pending' }] },
      ],
    })
    const users = db.collection('users')

    const result = await users.updateOne(
      { 'items.status': 'pending' },
      { $set: { 'items.$[item].status': 'archived' } },
      { sort: { priority: -1 }, arrayFilters: [{ 'item.status': 'pending' }] },
    )

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })
    expect(await users.findOne({ _id: 2 })).toMatchObject({ items: [{ status: 'archived' }] })
    expect(await users.findOne({ _id: 1 })).toMatchObject({ items: [{ status: 'pending' }, { status: 'done' }] })
  })

  test('supports insertMany ordered false duplicate-key behavior', async () => {
    const db = new MockMongoDb()
    const users = db.collection('users')

    await users.createIndex({ email: 1 }, { unique: true })
    await users.insertOne({ _id: 1, email: 'alice@example.com' })

    const result = await users.insertMany([
      { _id: 2, email: 'alice@example.com' },
      { _id: 3, email: 'bob@example.com' },
    ], { ordered: false })

    expect(result).toMatchObject({ acknowledged: true, insertedCount: 1 })
    expect(await users.find().sort({ _id: 1 }).toArray()).toMatchObject([
      { _id: 1, email: 'alice@example.com' },
      { _id: 3, email: 'bob@example.com' },
    ])
  })

  test('supports cursor next, hasNext, forEach, map, and close', async () => {
    const db = mockDb({
      users: [{ _id: 1 }, { _id: 2 }],
    })

    const cursor = db.collection('users').find()

    expect(await cursor.hasNext()).toBe(true)
    expect(await cursor.next()).toMatchObject({ _id: 1 })

    const seen: unknown[] = []
    await cursor.forEach(user => seen.push(user._id))
    expect(seen).toEqual([2])

    const mapped = await db.collection('users').find().map(user => user._id).toArray()
    expect(mapped).toEqual([1, 2])

    await expect(db.collection('users').find().close()).resolves.toBeUndefined()
  })

  test('enforces compound unique indexes and rejects duplicate existing data when creating one', async () => {
    const db = mockDb({
      users: [
        { _id: 1, tenantId: 't1', email: 'alice@example.com' },
        { _id: 2, tenantId: 't1', email: 'alice@example.com' },
      ],
    })
    const users = db.collection('users')

    await expect(users.createIndex({ tenantId: 1, email: 1 }, { unique: true })).rejects.toThrow()

    db.setCollectionData('users', [{ _id: 1, tenantId: 't1', email: 'alice@example.com' }])
    await users.createIndex({ tenantId: 1, email: 1 }, { unique: true })
    await expect(users.insertOne({ _id: 2, tenantId: 't1', email: 'alice@example.com' })).rejects.toThrow()
    await expect(users.insertOne({ _id: 3, tenantId: 't2', email: 'alice@example.com' })).resolves.toMatchObject({ acknowledged: true })
  })

  test('runs lookup with pipeline and let variables', async () => {
    const db = mockDb({
      users: [
        { _id: 'u1', name: 'Alice', active: true },
        { _id: 'u2', name: 'Bob', active: false },
      ],
      matches: [{ _id: 'm1', userIds: ['u1', 'u2'] }],
    })

    const result = await db.collection('matches').aggregate([
      {
        $lookup: {
          from: 'users',
          let: { ids: '$userIds' },
          pipeline: [
            { $match: { $expr: { $in: ['$_id', '$$ids'] } } },
            { $match: { active: true } },
            { $project: { name: 1, _id: 0 } },
          ],
          as: 'activeUsers',
        },
      },
    ]).toArray()

    expect(result).toMatchObject([{ _id: 'm1', activeUsers: [{ name: 'Alice' }] }])
  })

  test('supports ObjectId equality through mingo', async () => {
    const { ObjectId } = await import('mongodb')
    const userId = new ObjectId()
    const db = mockDb({
      users: [{ _id: userId, name: 'Alice' }],
    })

    await expect(db.collection('users').findOne({ _id: new ObjectId(userId.toHexString()) }))
      .resolves.toMatchObject({ name: 'Alice' })
  })

  test('does not expose mutable backing documents from query results', async () => {
    const db = mockDb({
      users: [{ _id: 1, profile: { name: 'Alice' } }],
    })

    const [user] = await db.collection('users').find().toArray()
    ;(user.profile as { name: string }).name = 'Mutated Outside Db'

    await expect(db.collection('users').findOne({ _id: 1 }))
      .resolves.toMatchObject({ profile: { name: 'Alice' } })
  })

  test('passes through mingo comparison, logical, element, evaluation, and array query operators', async () => {
    const db = mockDb({
      users: [
        { _id: 1, name: 'Alice', age: 30, score: 32, tags: ['admin', 'player'], deletedAt: null },
        { _id: 2, name: 'Bob', age: 17, score: 9, tags: ['player'] },
        { _id: 3, name: 'Carol', age: 40, score: 20, tags: ['spectator'], deletedAt: new Date('2024-01-01') },
      ],
    })

    await expect(db.collection('users').find({
      $and: [
        { age: { $gte: 18, $lt: 40 } },
        { name: { $regex: /^a/i } },
        { tags: { $all: ['admin', 'player'], $size: 2 } },
        { deletedAt: { $type: 'null' } },
        { score: { $mod: [5, 2] } },
        { $expr: { $gt: ['$score', '$age'] } },
      ],
      $nor: [{ name: 'Bob' }],
    }).toArray()).resolves.toMatchObject([{ _id: 1 }])

    await expect(db.collection('users').find({ deletedAt: { $exists: false } }).toArray())
      .resolves.toMatchObject([{ _id: 2 }])
  })

  test('passes through mingo projection operators', async () => {
    const db = mockDb({
      posts: [{
        _id: 1,
        title: 'Post',
        comments: [
          { author: 'Alice', visible: false },
          { author: 'Bob', visible: true },
        ],
        tags: ['one', 'two', 'three'],
      }],
    })

    await expect(db.collection('posts').findOne(
      { _id: 1 },
      { projection: { title: 1, comments: { $elemMatch: { visible: true } }, tags: { $slice: 2 } } },
    )).resolves.toEqual({ title: 'Post', comments: [{ author: 'Bob', visible: true }], tags: ['one', 'two'], _id: 1 })
  })

  test('passes through common mingo aggregation stages and expressions', async () => {
    const db = mockDb({
      sales: [
        { _id: 1, region: 'north', rep: 'Alice', amount: 10, items: ['a', 'b'] },
        { _id: 2, region: 'north', rep: 'Bob', amount: 20, items: ['c'] },
        { _id: 3, region: 'south', rep: 'Carol', amount: 15, items: [] },
      ],
    })

    await expect(db.collection('sales').aggregate([
      { $match: { amount: { $gte: 10 } } },
      { $addFields: { doubled: { $multiply: ['$amount', 2] } } },
      { $unwind: { path: '$items', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$region', total: { $sum: '$amount' }, reps: { $addToSet: '$rep' }, maxDouble: { $max: '$doubled' } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, region: '$_id', total: 1, reps: 1, maxDouble: 1 } },
    ]).toArray()).resolves.toEqual([
      { region: 'north', total: 40, reps: ['Alice', 'Bob'], maxDouble: 40 },
      { region: 'south', total: 15, reps: ['Carol'], maxDouble: 30 },
    ])
  })

  test('passes through mingo facet, bucket, sortByCount, count, and replaceRoot aggregation stages', async () => {
    const db = mockDb({
      sales: [
        { _id: 1, region: 'north', amount: 10, nested: { id: 'a', value: 1 } },
        { _id: 2, region: 'north', amount: 20, nested: { id: 'b', value: 2 } },
        { _id: 3, region: 'south', amount: 35, nested: { id: 'c', value: 3 } },
      ],
    })

    await expect(db.collection('sales').aggregate([
      { $facet: {
        counts: [{ $count: 'total' }],
        buckets: [{ $bucket: { groupBy: '$amount', boundaries: [0, 20, 40], default: 'other', output: { count: { $sum: 1 } } } }],
        regions: [{ $sortByCount: '$region' }],
        roots: [{ $replaceRoot: { newRoot: '$nested' } }, { $sort: { id: 1 } }],
      } },
    ]).toArray()).resolves.toEqual([{
      counts: [{ total: 3 }],
      buckets: [{ _id: 0, count: 2 }, { _id: 20, count: 1 }],
      regions: [{ _id: 'north', count: 2 }, { _id: 'south', count: 1 }],
      roots: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }],
    }])
  })

  // This fails because it fails in mingo. Fix PR submitted.
  test('passes through mingo update operators', async () => {
    const db = mockDb({
      users: [{
        _id: 1,
        name: 'Alice',
        oldName: 'A',
        count: 1,
        score: 10,
        tags: ['one'],
        removeTags: ['one', 'two'],
        remove: true,
        pushNumbers: [1, 2, 3],
        popNumbers: [1, 2, 3],
        pullAll: ['a', 'b', 'c'],
      }],
    })

    const result = await db.collection('users').updateOne(
      { _id: 1 },
      {
        $inc: { count: 2 },
        $mul: { score: 3 },
        $min: { floor: 5 },
        $max: { ceiling: 9 },
        $addToSet: { tags: { $each: ['one', 'two'] } },
        $push: { pushNumbers: { $each: [4, 5], $slice: -3 } },
        $pull: { removeTags: 'one' },
        $pullAll: { pullAll: ['a', 'c'] },
        $pop: { popNumbers: -1 },
        $rename: { oldName: 'alias' },
        $unset: { remove: '' },
        $currentDate: { touchedAt: true },
      },
    )

    expect(result).toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })
    const user = await db.collection('users').findOne({ _id: 1 })
    expect(user).toMatchObject({
      _id: 1,
      name: 'Alice',
      alias: 'A',
      count: 3,
      score: 30,
      floor: 5,
      ceiling: 9,
      tags: ['one', 'two'],
      removeTags: ['two'],
      pushNumbers: [3, 4, 5],
      popNumbers: [2, 3],
      pullAll: ['b'],
    })
    expect(user).not.toHaveProperty('remove')
    expect(user?.touchedAt).toBeInstanceOf(Date)
  })

  test('passes through aggregation pipeline updates', async () => {
    const db = mockDb({
      users: [{ _id: 1, first: 'Alice', last: 'Example', score: 10 }],
    })

    await expect(db.collection('users').updateOne(
      { _id: 1 },
      [
        { $set: { fullName: { $concat: ['$first', ' ', '$last'] }, doubledScore: { $multiply: ['$score', 2] } } },
        { $unset: ['last'] },
      ],
    )).resolves.toMatchObject({ acknowledged: true, matchedCount: 1, modifiedCount: 1 })

    await expect(db.collection('users').findOne({ _id: 1 }))
      .resolves.toMatchObject({ first: 'Alice', fullName: 'Alice Example', doubledScore: 20 })
  })
})
