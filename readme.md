# mingo-mongo-mock

MongoDB-driver-shaped in-memory mock collections powered by [mingo](https://github.com/kofrasa/mingo).

This package is intended for tests that want to exercise code written against a small MongoDB collection API without starting MongoDB or `mongodb-memory-server`.

It is **not** a full MongoDB server or a complete replacement for the official MongoDB Node driver. Query, aggregation, and update semantics are delegated to mingo.

## Install

```sh
pnpm add -D mingo-mongo-mock
```

## Usage

```ts
import { createMingoMongoDb } from 'mingo-mongo-mock'

const db = createMingoMongoDb({
  users: [
    { _id: 'u1', name: 'Alice', age: 30 },
    { _id: 'u2', name: 'Bob', age: 17 },
  ],
})

const users = db.collection('users')

const adults = await users
  .find({ age: { $gte: 18 } })
  .sort({ name: 1 })
  .toArray()

await users.updateOne(
  { _id: 'u1' },
  { $set: { active: true } },
)
```

Aggregation `$lookup` can resolve other named collections from the same mock DB:

```ts
const db = createMingoMongoDb({
  users: [{ _id: 'u1', name: 'Alice' }],
  matches: [{ _id: 'm1', userIds: ['u1'] }],
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
```

## API

```ts
createMingoMongoDb(seed?: Record<string, object[]>): MingoMongoDb
```

Supported collection methods in the initial API:

- `find(filter?, projectionOrOptions?).sort(...).skip(...).limit(...).toArray()`
- `findOne(filter?, projectionOrOptions?)`
- `aggregate(pipeline).toArray()`
- `insertOne(document)`
- `insertMany(documents)`
- `updateOne(filter, update)`
- `updateMany(filter, update)`
- `deleteOne(filter)`
- `deleteMany(filter)`
- `createIndex()` no-op for compatibility

Mock DB helpers:

- `db.collection(name)`
- `db.seed(seed)`
- `db.reset(seed?)`
- `db.getCollectionData(name)`
- `db.setCollectionData(name, documents)`

## Development

```sh
pnpm install
pnpm test
pnpm build
pnpm pack --dry-run
```

## License

MIT
