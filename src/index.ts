import mingo from 'mingo'
import { ObjectId } from 'mongodb'

export type Document = object
export type AnyDocument = Record<string, any>
export type InitialData = Record<string, Document[]>
export type Filter<T extends Document> = Partial<T> | Document
export type Projection<T extends Document> = Partial<Record<keyof T | string, unknown>>
export type Sort = Record<string, 1 | -1>
export type Update = Document | Document[]
type Insertable<T extends Document> = T extends { _id: unknown }
  ? Omit<T, '_id'> & Partial<Pick<T, '_id'>>
  : T

export interface InsertOneResult {
  acknowledged: true
  insertedId: unknown
}

export interface InsertManyResult {
  acknowledged: true
  insertedCount: number
  insertedIds: Record<number, unknown>
}

export interface DeleteResult {
  acknowledged: true
  deletedCount: number
}

export interface UpdateResult {
  acknowledged: true
  matchedCount: number
  modifiedCount: number
  upsertedCount?: number
  upsertedId?: unknown
}

type FindOptions<T extends Document> = {
  projection?: Projection<T>
  sort?: Sort
  skip?: number
  limit?: number
}

type WriteOptions = {
  upsert?: boolean
  arrayFilters?: Document[]
  sort?: Sort
}

type IndexSpec = Record<string, 1 | -1>
type IndexOptions = { unique?: boolean; name?: string }
type UniqueIndex = { spec: IndexSpec; name: string }

function isFindOptions<T extends Document>(value: FindOptions<T> | Projection<T>): value is FindOptions<T> {
  return Object.hasOwn(value, 'projection') || Object.hasOwn(value, 'sort') ||
    Object.hasOwn(value, 'skip') || Object.hasOwn(value, 'limit')
}

function clone<T>(value: T): T {
  if (value instanceof ObjectId)
    return new ObjectId(value.id) as T
  if (value instanceof Date)
    return new Date(value) as T
  if (Array.isArray(value))
    return value.map(item => clone(item)) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)])
    ) as T

  return value
}

function getByPath(document: unknown, path: string) {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value == null)
      return undefined
    return (value as Record<string, unknown>)[key]
  }, document)
}

function setByPath(document: Document, path: string, value: unknown) {
  const parts = path.split('.')
  let target = document as Record<string, unknown>

  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object')
      target[part] = {}
    target = target[part] as Record<string, unknown>
  }

  target[parts.at(-1)!] = value
}

function deleteByPath(document: Document, path: string) {
  const parts = path.split('.')
  let target = document as Record<string, unknown>

  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object')
      return
    target = target[part] as Record<string, unknown>
  }

  delete target[parts.at(-1)!]
}

function keyFor(value: unknown) {
  if (value instanceof ObjectId)
    return `objectid:${value.toHexString()}`
  return JSON.stringify(value)
}

function uniqueKey(document: Document, spec: IndexSpec) {
  return Object.keys(spec).map(path => keyFor(getByPath(document, path))).join('\u0000')
}

function mongoDuplicateKeyError(indexName: string) {
  const error = new Error(`E11000 duplicate key error collection: mock index: ${indexName}`) as Error & { code: number }
  error.code = 11000
  return error
}

function normalizeOptions<T extends Document>(optionsOrProjection: FindOptions<T> | Projection<T> = {}): FindOptions<T> {
  return isFindOptions(optionsOrProjection)
    ? optionsOrProjection
    : { projection: optionsOrProjection }
}

function updateResult(result: { matchedCount: number; modifiedCount: number }): UpdateResult {
  return {
    acknowledged: true,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  }
}

function createUpsertDocument<T extends Document>(filter: Filter<T>, update: Update): T {
  const document: Document = {}

  for (const [key, value] of Object.entries(filter))
    if (!key.startsWith('$') && typeof value !== 'object')
      setByPath(document, key, clone(value))

  if (Array.isArray(update)) {
    const [updated] = mingo.aggregate([document] as never, update as never)
    return ensureId(updated as T)
  }

  const modifierKeys = Object.keys(update)
  const isModifier = modifierKeys.some(key => key.startsWith('$'))
  if (isModifier) {
    const setOnInsert = (update as { $setOnInsert?: Document }).$setOnInsert ?? {}
    const set = (update as { $set?: Document }).$set ?? {}
    for (const [key, value] of Object.entries(setOnInsert))
      setByPath(document, key, clone(value))
    for (const [key, value] of Object.entries(set))
      setByPath(document, key, clone(value))
    return ensureId(document as T)
  }

  return ensureId(clone(update as T))
}

function ensureId<T extends Document>(document: T): T {
  const doc = document as T & { _id?: unknown }
  if (doc._id === undefined)
    doc._id = new ObjectId()
  return doc
}

export class MockMongoDb {
  #collections: InitialData = {}
  #indexes = new Map<string, UniqueIndex[]>()

  constructor(seed: InitialData = {}) {
    this.seed(seed)
  }

  collection<T extends Document = AnyDocument>(name: string) {
    if (!this.#collections[name])
      this.#collections[name] = []
    if (!this.#indexes.has(name))
      this.#indexes.set(name, [])

    return new MockCollection<T>(name, this)
  }

  seed(seed: InitialData) {
    this.#collections = { ...seed }
  }

  reset(seed: InitialData = {}) {
    this.seed(seed)
  }

  getCollectionData<T extends Document = AnyDocument>(name: string): T[] {
    if (!this.#collections[name])
      this.#collections[name] = []

    return this.#collections[name] as T[]
  }

  setCollectionData<T extends Document = AnyDocument>(name: string, documents: T[]) {
    this.#collections[name] = documents
  }

  getUniqueIndexes(name: string) {
    return this.#indexes.get(name) ?? []
  }

  addUniqueIndex(name: string, index: UniqueIndex) {
    if (!this.#indexes.has(name))
      this.#indexes.set(name, [])
    this.#indexes.get(name)!.push(index)
  }
}

export class MockCollection<T extends Document = AnyDocument> {
  constructor(
    private readonly name: string,
    private readonly db: MockMongoDb,
  ) {}

  private get documents() {
    return this.db.getCollectionData<T>(this.name)
  }

  find(filter: Filter<T> = {}, optionsOrProjection: FindOptions<T> | Projection<T> = {}) {
    const options = normalizeOptions(optionsOrProjection)
    const cursor = new FindCursor(this.documents, filter, options.projection)

    if (options.sort)
      cursor.sort(options.sort)
    if (options.skip !== undefined)
      cursor.skip(options.skip)
    if (options.limit !== undefined)
      cursor.limit(options.limit)

    return cursor
  }

  async findOne(filter: Filter<T> = {}, optionsOrProjection: FindOptions<T> | Projection<T> = {}): Promise<T | null> {
    const [document] = await this.find(filter, optionsOrProjection).limit(1).toArray()
    return document ?? null
  }

  aggregate<R extends Document = Document>(pipeline: Document[] = []) {
    return new AggregationCursor<R>(this.documents, pipeline, this.db)
  }

  async insertOne(document: Insertable<T>): Promise<InsertOneResult> {
    const inserted = ensureId(document as T)
    this.assertNoUniqueIndexViolation(inserted)
    this.documents.push(inserted)
    return { acknowledged: true, insertedId: (inserted as { _id: unknown })._id }
  }

  async insertMany(documents: Insertable<T>[], options: { ordered?: boolean } = {}): Promise<InsertManyResult> {
    const insertedIds: Record<number, unknown> = {}
    let insertedCount = 0
    let firstError: unknown

    for (const [index, document] of documents.entries()) {
      try {
        const result = await this.insertOne(document)
        insertedIds[index] = result.insertedId
        insertedCount++
      } catch (error) {
        firstError ??= error
        if (options.ordered !== false)
          throw error
      }
    }

    if (firstError && options.ordered !== false)
      throw firstError

    return { acknowledged: true, insertedCount, insertedIds }
  }

  async updateOne(filter: Filter<T>, update: Update, options: WriteOptions = {}): Promise<UpdateResult> {
    const result = mingo.updateOne(this.documents as never, filter as never, update as never, {
      arrayFilters: options.arrayFilters,
      sort: options.sort,
    } as never)

    if (result.matchedCount === 0 && options.upsert) {
      const document = createUpsertDocument<T>(filter, update)
      this.assertNoUniqueIndexViolation(document)
      this.documents.push(document)
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: (document as { _id: unknown })._id,
      }
    }

    return updateResult(result)
  }

  async updateMany(filter: Filter<T>, update: Update, options: Pick<WriteOptions, 'arrayFilters'> = {}): Promise<UpdateResult> {
    const result = mingo.updateMany(this.documents as never, filter as never, update as never, {
      arrayFilters: options.arrayFilters,
    } as never)
    return updateResult(result)
  }

  async replaceOne(filter: Filter<T>, replacement: T, options: Pick<WriteOptions, 'upsert'> = {}): Promise<UpdateResult> {
    const [match] = mingo.find<T, T>(this.documents, filter as never).limit(1).all()

    if (!match) {
      if (!options.upsert)
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 }

      const document = ensureId(createUpsertDocument<T>(filter, replacement))
      this.assertNoUniqueIndexViolation(document)
      this.documents.push(document)
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: (document as { _id: unknown })._id,
      }
    }

    const index = this.documents.indexOf(match)
    const id = (match as { _id?: unknown })._id
    const document = clone(replacement) as T & { _id?: unknown }
    if (document._id === undefined && id !== undefined)
      document._id = id
    this.assertNoUniqueIndexViolation(document, match)
    this.documents[index] = document as T
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 }
  }

  async findOneAndUpdate(filter: Filter<T>, update: Update, options: WriteOptions & { returnDocument?: 'before' | 'after'; projection?: Projection<T> } = {}) {
    const before = await this.findOne(filter)

    if (!before && options.upsert)
      await this.updateOne(filter, update, { upsert: true, arrayFilters: options.arrayFilters, sort: options.sort })
    else if (before)
      await this.updateOne(filter, update, { arrayFilters: options.arrayFilters, sort: options.sort })

    const value = options.returnDocument === 'after'
      ? await this.findOne(filter, { projection: options.projection })
      : before
        ? projectOne(before, options.projection)
        : options.upsert
          ? await this.findOne(filter, { projection: options.projection })
          : null

    return { ok: 1, value }
  }

  async deleteOne(filter: Filter<T>): Promise<DeleteResult> {
    const [match] = mingo.find<T, T>(this.documents, filter as never).limit(1).all()
    if (!match)
      return { acknowledged: true, deletedCount: 0 }

    const index = this.documents.indexOf(match)
    if (index === -1)
      return { acknowledged: true, deletedCount: 0 }

    this.documents.splice(index, 1)
    return { acknowledged: true, deletedCount: 1 }
  }

  async deleteMany(filter: Filter<T>): Promise<DeleteResult> {
    const matches = new Set(mingo.find<T, T>(this.documents, filter as never).all())
    const originalLength = this.documents.length
    const kept = this.documents.filter(document => !matches.has(document))
    this.db.setCollectionData(this.name, kept)

    return {
      acknowledged: true,
      deletedCount: originalLength - kept.length,
    }
  }

  async countDocuments(filter: Filter<T> = {}) {
    return mingo.find<T, T>(this.documents, filter as never).all().length
  }

  async distinct(path: string, filter: Filter<T> = {}) {
    const values: unknown[] = []
    const seen = new Set<string>()

    for (const document of mingo.find<T, T>(this.documents, filter as never).all()) {
      const value = getByPath(document, path)
      const candidates = Array.isArray(value) ? value : [value]
      for (const candidate of candidates) {
        const key = keyFor(candidate)
        if (!seen.has(key)) {
          seen.add(key)
          values.push(clone(candidate))
        }
      }
    }

    return values
  }

  async createIndex(spec: IndexSpec, options: IndexOptions = {}) {
    const name = options.name ?? Object.entries(spec).map(([key, direction]) => `${key}_${direction}`).join('_')

    if (options.unique) {
      const seen = new Set<string>()
      for (const document of this.documents) {
        const key = uniqueKey(document, spec)
        if (seen.has(key))
          throw mongoDuplicateKeyError(name)
        seen.add(key)
      }
      this.db.addUniqueIndex(this.name, { spec, name })
    }

    return name
  }

  private assertNoUniqueIndexViolation(document: T, ignore?: T) {
    for (const index of this.db.getUniqueIndexes(this.name)) {
      const key = uniqueKey(document, index.spec)
      const duplicate = this.documents.find(existing => existing !== ignore && uniqueKey(existing, index.spec) === key)
      if (duplicate)
        throw mongoDuplicateKeyError(index.name)
    }
  }
}

function projectOne<T extends Document>(document: T, projection?: Projection<T>) {
  if (!projection)
    return clone(document)

  return mingo.find<T, T>([document], {}, projection as never).all()[0] ?? null
}

export class FindCursor<T extends Document = AnyDocument> {
  #sort?: Sort
  #skip = 0
  #limit?: number
  #buffer?: T[]
  #index = 0
  #closed = false
  #mapper?: (document: T) => unknown

  constructor(
    private readonly documents: T[],
    private readonly filter: Filter<T>,
    private readonly projection?: Projection<T>,
  ) {}

  sort(sort: Sort) {
    this.#sort = sort
    this.#buffer = undefined
    return this
  }

  skip(count: number) {
    this.#skip = count
    this.#buffer = undefined
    return this
  }

  limit(count: number) {
    this.#limit = count
    this.#buffer = undefined
    return this
  }

  map<R>(mapper: (document: T) => R) {
    const cursor = new FindCursor<T>(this.documents, this.filter, this.projection)
    cursor.#sort = this.#sort
    cursor.#skip = this.#skip
    cursor.#limit = this.#limit
    cursor.#mapper = mapper
    return cursor as unknown as FindCursor<R & Document>
  }

  async toArray(): Promise<T[]> {
    const documents = this.evaluate().slice(this.#index)
    this.#index = this.evaluate().length
    return documents.map(document => this.#mapper ? this.#mapper(document) : clone(document)) as T[]
  }

  async next() {
    if (this.#closed)
      return null
    const documents = this.evaluate()
    const document = documents[this.#index++]
    if (!document)
      return null
    return clone(document)
  }

  async hasNext() {
    return !this.#closed && this.#index < this.evaluate().length
  }

  async forEach(callback: (document: T) => unknown | Promise<unknown>) {
    while (await this.hasNext()) {
      const document = await this.next()
      if (document)
        await callback(document)
    }
  }

  async close() {
    this.#closed = true
  }

  async *[Symbol.asyncIterator]() {
    while (await this.hasNext()) {
      const document = await this.next()
      if (document)
        yield document
    }
  }

  private evaluate() {
    if (this.#buffer)
      return this.#buffer

    let cursor = mingo.find<T, T>(this.documents, this.filter as never, this.projection as never)

    if (this.#sort)
      cursor = cursor.sort(this.#sort)
    if (this.#skip)
      cursor = cursor.skip(this.#skip)
    if (this.#limit !== undefined)
      cursor = cursor.limit(this.#limit)

    this.#buffer = cursor.all()
    return this.#buffer
  }
}

export class AggregationCursor<T extends Document = AnyDocument> {
  constructor(
    private readonly documents: Document[],
    private readonly pipeline: Document[],
    private readonly db: MockMongoDb,
  ) {}

  async toArray() {
    return clone(mingo.aggregate(this.documents as never, this.pipeline as never, {
      collectionResolver: name => this.db.getCollectionData(name),
    }) as T[])
  }
}
