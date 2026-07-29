import { describe, expect, test } from 'vitest'
import { MockMongoDb } from './index'

describe('AggregationCursor', () => {
  test('next returns matching aggregation results in order, then null', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [
      { _id: 'm1', state: 'started' },
      { _id: 'm2', state: 'waiting' },
      { _id: 'm3', state: 'started' },
    ])

    const cursor = db.collection('matches').aggregate([
      { $match: { state: 'started' } },
      { $sort: { _id: 1 } },
    ])

    await expect(cursor.next()).resolves.toMatchObject({ _id: 'm1' })
    await expect(cursor.next()).resolves.toMatchObject({ _id: 'm3' })
    await expect(cursor.next()).resolves.toBeNull()
  })

  test('hasNext reflects aggregate cursor state', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }])

    const cursor = db.collection('matches').aggregate()

    await expect(cursor.hasNext()).resolves.toBe(true)
    await cursor.next()
    await expect(cursor.hasNext()).resolves.toBe(false)
  })

  test('forEach visits aggregate results', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }])
    const ids: unknown[] = []

    await db.collection('matches').aggregate([{ $sort: { _id: 1 } }]).forEach(match => {
      ids.push((match as { _id: unknown })._id)
    })

    expect(ids).toEqual(['m1', 'm2'])
  })

  test('close stops aggregate iteration', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }])

    const cursor = db.collection('matches').aggregate()
    await cursor.close()

    await expect(cursor.hasNext()).resolves.toBe(false)
    await expect(cursor.next()).resolves.toBeNull()
  })

  test('supports async iteration', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }])
    const ids: unknown[] = []

    for await (const match of db.collection('matches').aggregate([{ $sort: { _id: 1 } }]))
      ids.push((match as { _id: unknown })._id)

    expect(ids).toEqual(['m1', 'm2'])
  })

  test('map transforms aggregate cursor results for toArray, next, and async iteration', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [
      { _id: 'm1', score: 20 },
      { _id: 'm2', score: 10 },
      { _id: 'm3', score: 30 },
    ])

    const mappedForArray = await db.collection<{ _id: string; score: number }>('matches')
      .aggregate([{ $sort: { score: 1 } }])
      .map(match => `${match._id}:${match.score}`)
      .toArray()
    expect(mappedForArray).toEqual(['m2:10', 'm1:20', 'm3:30'])

    const mappedForNext = db.collection<{ _id: string; score: number }>('matches')
      .aggregate([{ $sort: { score: 1 } }])
      .map(match => match.score * 2)
    await expect(mappedForNext.next()).resolves.toBe(20)
    await expect(mappedForNext.next()).resolves.toBe(40)

    const iterated: number[] = []
    for await (const score of db.collection<{ _id: string; score: number }>('matches')
      .aggregate([{ $sort: { score: 1 } }])
      .map(match => match.score)) {
      iterated.push(score)
    }
    expect(iterated).toEqual([10, 20, 30])
  })

  test('rewind resets aggregate cursor position after partial and full consumption', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [
      { _id: 'm1', score: 10 },
      { _id: 'm2', score: 20 },
    ])

    const cursor = db.collection('matches').aggregate([{ $sort: { _id: 1 } }])

    await expect(cursor.next()).resolves.toMatchObject({ _id: 'm1' })
    cursor.rewind()
    await expect(cursor.next()).resolves.toMatchObject({ _id: 'm1' })
    await expect(cursor.toArray()).resolves.toMatchObject([{ _id: 'm2' }])

    cursor.rewind()
    await expect(cursor.toArray()).resolves.toMatchObject([{ _id: 'm1' }, { _id: 'm2' }])
  })

  test('builder chain appends match, sort, skip, limit, and project stages in order', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [
      { _id: 'm1', state: 'started', score: 30, secret: 'hidden' },
      { _id: 'm2', state: 'waiting', score: 40, secret: 'hidden' },
      { _id: 'm3', state: 'started', score: 10, secret: 'hidden' },
      { _id: 'm4', state: 'started', score: 20, secret: 'hidden' },
    ])

    const result = await db.collection('matches')
      .aggregate()
      .match({ state: 'started' })
      .sort({ score: 1 })
      .skip(1)
      .limit(1)
      .project<{ _id: string; score: number }>({ _id: 1, score: 1 })
      .toArray()

    expect(result).toEqual([{ _id: 'm4', score: 20 }])
  })

  test('addStage and group append arbitrary and grouped aggregation stages', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('sales', [
      { _id: 's1', store: 'north', amount: 5 },
      { _id: 's2', store: 'north', amount: 7 },
      { _id: 's3', store: 'south', amount: 11 },
    ])

    const result = await db.collection('sales')
      .aggregate()
      .addStage({ $match: { amount: { $gte: 6 } } })
      .group<{ _id: string; total: number }>({ _id: '$store', total: { $sum: '$amount' } })
      .sort({ _id: 1 })
      .toArray()

    expect(result).toEqual([
      { _id: 'north', total: 7 },
      { _id: 'south', total: 11 },
    ])
  })

  test('lookup, unwind, and group builders resolve related in-memory collections', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('users', [
      { _id: 'u1', name: 'Alice' },
      { _id: 'u2', name: 'Bob' },
    ])
    db.setCollectionData('matches', [
      { _id: 'm1', userIds: ['u1', 'u2'] },
      { _id: 'm2', userIds: ['u2'] },
    ])

    const result = await db.collection('matches')
      .aggregate()
      .lookup({
        from: 'users',
        localField: 'userIds',
        foreignField: '_id',
        as: 'users',
      })
      .unwind('$users')
      .group<{ _id: string; names: string[]; count: number }>({
        _id: '$_id',
        names: { $push: '$users.name' },
        count: { $sum: 1 },
      })
      .sort({ _id: 1 })
      .toArray()

    expect(result).toEqual([
      { _id: 'm1', names: ['Alice', 'Bob'], count: 2 },
      { _id: 'm2', names: ['Bob'], count: 1 },
    ])
  })

  test('batchSize, maxTimeMS, and addCursorFlag are chainable no-op configuration methods', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }])

    const cursor = db.collection('matches')
      .aggregate([{ $sort: { _id: 1 } }])
      .batchSize(1)
      .maxTimeMS(100)
      .addCursorFlag('noCursorTimeout', true)

    await expect(cursor.toArray()).resolves.toEqual([{ _id: 'm1' }, { _id: 'm2' }])
  })

  test('tryNext returns the next aggregate result and null after exhaustion', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }])

    const cursor = db.collection('matches').aggregate([{ $sort: { _id: 1 } }])

    await expect(cursor.tryNext()).resolves.toEqual({ _id: 'm1' })
    await expect(cursor.tryNext()).resolves.toEqual({ _id: 'm2' })
    await expect(cursor.tryNext()).resolves.toBeNull()
  })

  test('clone returns an independent cursor with the same pipeline and mapper', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [
      { _id: 'm1', score: 10 },
      { _id: 'm2', score: 20 },
    ])

    const cursor = db.collection<{ _id: string; score: number }>('matches')
      .aggregate([{ $sort: { score: 1 } }])
      .map(match => match.score)

    await expect(cursor.next()).resolves.toBe(10)

    const clone = cursor.clone()

    await expect(cursor.next()).resolves.toBe(20)
    await expect(clone.toArray()).resolves.toEqual([10, 20])
  })

  test('bufferedCount and readBufferedDocuments expose and consume buffered aggregate results', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }, { _id: 'm3' }])

    const cursor = db.collection('matches').aggregate([{ $sort: { _id: 1 } }])

    expect(cursor.bufferedCount()).toBe(3)
    expect(cursor.readBufferedDocuments(2)).toEqual([{ _id: 'm1' }, { _id: 'm2' }])
    expect(cursor.bufferedCount()).toBe(1)
    await expect(cursor.next()).resolves.toEqual({ _id: 'm3' })
    expect(cursor.readBufferedDocuments()).toEqual([])
  })

  test('stream exposes aggregate results as a readable async iterable', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }, { _id: 'm2' }])
    const ids: unknown[] = []

    const stream = db.collection('matches').aggregate([{ $sort: { _id: 1 } }]).stream()

    for await (const match of stream)
      ids.push((match as { _id: unknown })._id)

    expect(ids).toEqual(['m1', 'm2'])
  })

  test('emits close when the aggregate cursor is closed', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }])

    const cursor = db.collection('matches').aggregate()
    const closed = new Promise<void>(resolve => cursor.on('close', resolve))

    await cursor.close()

    await expect(closed).resolves.toBeUndefined()
  })

  test('withReadPreference and withReadConcern are chainable compatibility configuration methods', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('matches', [{ _id: 'm1' }])

    const cursor = db.collection('matches')
      .aggregate()
      .withReadPreference('primary')
      .withReadConcern({ level: 'local' })

    await expect(cursor.toArray()).resolves.toEqual([{ _id: 'm1' }])
  })

  test('explain returns a useful mock explanation of the aggregate pipeline', async () => {
    const db = new MockMongoDb()
    const pipeline = [{ $match: { state: 'started' } }, { $limit: 1 }]

    await expect(db.collection('matches').aggregate(pipeline).explain()).resolves.toEqual({
      ok: 1,
      mock: true,
      pipeline,
    })
  })

  test('addStage supports addFields, set, unset, replaceRoot, replaceWith, count, and sortByCount stages', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('sales', [
      { _id: 's1', store: 'north', amount: 5, secret: 'a' },
      { _id: 's2', store: 'north', amount: 7, secret: 'b' },
      { _id: 's3', store: 'south', amount: 11, secret: 'c' },
    ])

    await expect(db.collection('sales')
      .aggregate()
      .addStage({ $addFields: { doubled: { $multiply: ['$amount', 2] } } })
      .addStage({ $set: { label: { $concat: ['$store', ':', { $toString: '$doubled' }] } } })
      .addStage({ $unset: 'secret' })
      .project({ _id: 0, store: 1, doubled: 1, label: 1, secret: 1 })
      .sort({ doubled: 1 })
      .toArray()).resolves.toEqual([
      { store: 'north', doubled: 10, label: 'north:10' },
      { store: 'north', doubled: 14, label: 'north:14' },
      { store: 'south', doubled: 22, label: 'south:22' },
    ])

    await expect(db.collection('sales')
      .aggregate()
      .addStage({ $replaceRoot: { newRoot: { store: '$store', amount: '$amount' } } })
      .sort({ amount: 1 })
      .toArray()).resolves.toEqual([
      { store: 'north', amount: 5 },
      { store: 'north', amount: 7 },
      { store: 'south', amount: 11 },
    ])

    await expect(db.collection('sales')
      .aggregate()
      .addStage({ $replaceWith: { store: '$store', bucket: { $cond: [{ $gte: ['$amount', 10] }, 'large', 'small'] } } })
      .sort({ store: 1, bucket: 1 })
      .toArray()).resolves.toEqual([
      { store: 'north', bucket: 'small' },
      { store: 'north', bucket: 'small' },
      { store: 'south', bucket: 'large' },
    ])

    await expect(db.collection('sales')
      .aggregate()
      .match({ store: 'north' })
      .addStage({ $count: 'northSales' })
      .toArray()).resolves.toEqual([{ northSales: 2 }])

    await expect(db.collection('sales')
      .aggregate()
      .addStage({ $sortByCount: '$store' })
      .sort({ _id: 1 })
      .toArray()).resolves.toEqual([
      { _id: 'north', count: 2 },
      { _id: 'south', count: 1 },
    ])
  })

  test('out writes aggregate results to another in-memory collection', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('sales', [
      { _id: 's1', store: 'north', amount: 5 },
      { _id: 's2', store: 'south', amount: 11 },
    ])

    await expect(db.collection('sales')
      .aggregate()
      .match({ amount: { $gte: 10 } })
      .out('largeSales')
      .toArray()).resolves.toEqual([])

    expect(db.getCollectionData('largeSales')).toEqual([{ _id: 's2', store: 'south', amount: 11 }])
  })

  test('redact removes documents pruned by the aggregation expression', async () => {
    const db = new MockMongoDb()
    db.setCollectionData('places', [
      { _id: 'p1', public: true, location: { type: 'Point', coordinates: [0, 0] } },
      { _id: 'p2', public: false, location: { type: 'Point', coordinates: [1, 1] } },
    ])

    await expect(db.collection('places')
      .aggregate()
      .redact({ $cond: [{ $eq: ['$public', true] }, '$$KEEP', '$$PRUNE'] })
      .sort({ _id: 1 })
      .toArray()).resolves.toEqual([
      { _id: 'p1', public: true, location: { type: 'Point', coordinates: [0, 0] } },
    ])
  })

  test('geoNear exists for API compatibility but throws unimplemented', () => {
    const db = new MockMongoDb()

    expect(() => db.collection('places').aggregate().geoNear({
      near: { type: 'Point', coordinates: [0, 0] },
      distanceField: 'distance',
      spherical: true,
    })).toThrow('AggregationCursor.geoNear is not implemented')
  })

  test('exposes mock cursor metadata getters compatible with mongodb cursors', async () => {
    const db = new MockMongoDb()
    const cursor = db.collection('matches').aggregate()

    expect(cursor.id).toBeUndefined()
    expect(cursor.namespace.toString()).toBe('mock.aggregate')
    expect(cursor.readPreference.mode).toBe('primary')
    expect(cursor.readConcern).toBeUndefined()
    expect(cursor.closed).toBe(false)
    expect(cursor.killed).toBe(false)
    expect(cursor.loadBalanced).toBe(false)

    await cursor.close()

    expect(cursor.closed).toBe(true)
  })

  test('asyncDispose closes the aggregate cursor and emits close once', async () => {
    const db = new MockMongoDb()
    const cursor = db.collection('matches').aggregate()
    let closeCount = 0
    cursor.on('close', () => closeCount++)

    await cursor[Symbol.asyncDispose]()
    await cursor[Symbol.asyncDispose]()

    expect(cursor.closed).toBe(true)
    expect(closeCount).toBe(1)
  })

  test('event listener methods are chainable on aggregate cursors', () => {
    const db = new MockMongoDb()
    const cursor = db.collection('matches').aggregate()
    const listener = () => {}

    expect(cursor.on('close', listener)).toBe(cursor)
    expect(cursor.once('close', listener)).toBe(cursor)
    expect(cursor.off('close', listener)).toBe(cursor)
    expect(cursor.addListener('close', listener)).toBe(cursor)
    expect(cursor.removeListener('close', listener)).toBe(cursor)
    expect(cursor.prependListener('close', listener)).toBe(cursor)
    expect(cursor.prependOnceListener('close', listener)).toBe(cursor)
    expect(cursor.removeAllListeners('close')).toBe(cursor)
    expect(cursor.setMaxListeners(20)).toBe(cursor)
  })
})
