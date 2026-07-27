# mingo-mongo-mock

MongoDB-driver-shaped in-memory mock database powered by [mingo](https://github.com/kofrasa/mingo).

Use this in tests when application code expects MongoDB-style collections, cursors, filters, updates, and aggregation pipelines, but you want the data to live in plain in-process JavaScript objects.

Query, projection, aggregation, and update semantics are delegated to mingo where possible. This is not a MongoDB server emulator.

## Install

```sh
pnpm add -D mingo-mongo-mock
```

## Usage

```ts
import { MockMongoDb } from 'mingo-mongo-mock'

const db = new MockMongoDb({
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

Documents inserted without `_id` get a MongoDB `ObjectId`:

```ts
const result = await users.insertOne({ name: 'Carol' })
console.log(result.insertedId)
```

Aggregation `$lookup` resolves other named collections from the same mock DB:

```ts
const db = new MockMongoDb({
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
new MockMongoDb(initialData?: InitialData)
```

`InitialData` is the starting database contents:

```ts
type InitialData = Record<string, object[]>
```

Each key is a collection name. Each value is that collection's initial documents.

### Database helpers

- `db.collection<T>(name)`
- `db.seed(initialData)`
- `db.reset(initialData?)`
- `db.getCollectionData<T>(name)`
- `db.setCollectionData<T>(name, documents)`

### Supported collection methods

- `find(filter?, projectionOrOptions?)`
- `findOne(filter?, projectionOrOptions?)`
- `aggregate(pipeline?)`
- `insertOne(document)`
- `insertMany(documents, options?)`
- `updateOne(filter, update, options?)`
- `updateMany(filter, update, options?)`
- `replaceOne(filter, replacement, options?)`
- `findOneAndUpdate(filter, update, options?)`
- `deleteOne(filter)`
- `deleteMany(filter)`
- `countDocuments(filter?)`
- `distinct(path, filter?)`
- `createIndex(spec, options?)`

`createIndex` supports unique indexes, including compound unique indexes, for duplicate-key checks in tests.

### Supported find cursor methods

- `sort(sort)`
- `skip(count)`
- `limit(count)`
- `map(fn)`
- `toArray()`
- `next()`
- `hasNext()`
- `forEach(fn)`
- `close()`
- async iteration with `for await`

### Supported aggregation cursor methods

- `toArray()`

## Notes

- Mongo query, projection, aggregation, and update operator behavior comes from mingo.
- `ObjectId` comes from the official `mongodb` package.
- Query results are cloned so mutating returned objects does not mutate stored documents.
- This package is intended for tests, not production persistence.

Known boundary: `mingo@7.2.2` currently has a `$rename` update bug; a fix PR has been submitted upstream.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

## License

MIT
