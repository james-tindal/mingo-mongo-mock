import { describe, expect, expectTypeOf, test } from 'vitest'
import { AggregationCursor } from './AggregationCursor'
import { MockMongoDb } from './index'
import mongo from 'mongodb'

describe('AggregationCursor', () => {
  test('exposes useful mongodb cursor methods', () => {
    type UsefulAggregationCursorMethods = Pick<mongo.AggregationCursor,
      | 'toArray'
      | 'next'
      | 'hasNext'
      | 'forEach'
      | 'close'
      | typeof Symbol.asyncIterator
    >

    expectTypeOf<AggregationCursor>().toMatchTypeOf<UsefulAggregationCursorMethods>()
  })

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
})
