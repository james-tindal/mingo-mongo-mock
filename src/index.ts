import {
  aggregate as mingoAggregate,
  find as mingoFind,
  updateMany as mingoUpdateMany,
  updateOne as mingoUpdateOne,
} from 'mingo'

export type Document = Record<string, unknown>
export type CollectionSeed = Record<string, Document[]>
export type Filter<T extends Document> = Partial<T> | Document
export type Projection<T extends Document> = Partial<Record<keyof T | string, 0 | 1 | boolean>>
export type Sort = Record<string, 1 | -1>
export type Update = Document | Document[]

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
  modifiedFields?: string[]
  modifiedIndex?: number
}

export function createMingoMongoDb(seed: CollectionSeed = {}) {
  return new MingoMongoDb(seed)
}

function isFindOptions<T extends Document>(value: { projection?: Projection<T> } | Projection<T>): value is { projection?: Projection<T> } {
  return Object.hasOwn(value, 'projection')
}

export class MingoMongoDb {
  #collections: CollectionSeed = {}

  constructor(seed: CollectionSeed = {}) {
    this.seed(seed)
  }

  collection<T extends Document = Document>(name: string) {
    if (!this.#collections[name])
      this.#collections[name] = []

    return new MingoMongoCollection<T>(name, this)
  }

  seed(seed: CollectionSeed) {
    this.#collections = { ...seed }
  }

  reset(seed: CollectionSeed = {}) {
    this.seed(seed)
  }

  getCollectionData<T extends Document = Document>(name: string): T[] {
    if (!this.#collections[name])
      this.#collections[name] = []

    return this.#collections[name] as T[]
  }

  setCollectionData<T extends Document = Document>(name: string, documents: T[]) {
    this.#collections[name] = documents
  }
}

export class MingoMongoCollection<T extends Document = Document> {
  constructor(
    private readonly name: string,
    private readonly db: MingoMongoDb,
  ) {}

  get documents() {
    return this.db.getCollectionData<T>(this.name)
  }

  find(filter: Filter<T> = {}, optionsOrProjection: { projection?: Projection<T> } | Projection<T> = {}) {
    const projection = isFindOptions<T>(optionsOrProjection)
      ? optionsOrProjection.projection
      : optionsOrProjection

    return new MingoMongoFindCursor(this.documents, filter, projection)
  }

  async findOne(filter: Filter<T> = {}, optionsOrProjection: { projection?: Projection<T> } | Projection<T> = {}) {
    const [document] = await this.find(filter, optionsOrProjection).limit(1).toArray()
    return document ?? null
  }

  aggregate<R extends Document = Document>(pipeline: Document[] = []) {
    return new MingoMongoAggregationCursor<R>(this.documents, pipeline, this.db)
  }

  async insertOne(document: T): Promise<InsertOneResult> {
    this.documents.push(document)
    return { acknowledged: true, insertedId: document._id }
  }

  async insertMany(documents: T[]): Promise<InsertManyResult> {
    this.documents.push(...documents)
    return {
      acknowledged: true,
      insertedCount: documents.length,
      insertedIds: Object.fromEntries(
        documents.map((document, index) => [index, document._id])
      ),
    }
  }

  async updateOne(filter: Filter<T>, update: Update): Promise<UpdateResult> {
    const result = mingoUpdateOne(this.documents, filter as never, update as never)
    return { acknowledged: true, ...result }
  }

  async updateMany(filter: Filter<T>, update: Update): Promise<UpdateResult> {
    const result = mingoUpdateMany(this.documents, filter as never, update as never)
    return { acknowledged: true, ...result }
  }

  async deleteOne(filter: Filter<T>): Promise<DeleteResult> {
    const [match] = mingoFind<T, T>(this.documents, filter as never).limit(1).all()
    if (!match)
      return { acknowledged: true, deletedCount: 0 }

    const index = this.documents.indexOf(match)
    if (index === -1)
      return { acknowledged: true, deletedCount: 0 }

    this.documents.splice(index, 1)
    return { acknowledged: true, deletedCount: 1 }
  }

  async deleteMany(filter: Filter<T>): Promise<DeleteResult> {
    const matches = new Set(mingoFind<T, T>(this.documents, filter as never).all())
    const originalLength = this.documents.length
    const kept = this.documents.filter(document => !matches.has(document))
    this.db.setCollectionData(this.name, kept)

    return {
      acknowledged: true,
      deletedCount: originalLength - kept.length,
    }
  }

  async createIndex() {
    return ''
  }
}

export class MingoMongoFindCursor<T extends Document = Document> {
  #sort?: Sort
  #skip = 0
  #limit?: number

  constructor(
    private readonly documents: T[],
    private readonly filter: Filter<T>,
    private readonly projection?: Projection<T>,
  ) {}

  sort(sort: Sort) {
    this.#sort = sort
    return this
  }

  skip(count: number) {
    this.#skip = count
    return this
  }

  limit(count: number) {
    this.#limit = count
    return this
  }

  async toArray() {
    let cursor = mingoFind<T, T>(this.documents, this.filter as never, this.projection as never)

    if (this.#sort)
      cursor = cursor.sort(this.#sort)
    if (this.#skip)
      cursor = cursor.skip(this.#skip)
    if (this.#limit !== undefined)
      cursor = cursor.limit(this.#limit)

    return cursor.all()
  }
}

export class MingoMongoAggregationCursor<T extends Document = Document> {
  constructor(
    private readonly documents: Document[],
    private readonly pipeline: Document[],
    private readonly db: MingoMongoDb,
  ) {}

  async toArray() {
    return mingoAggregate(this.documents, this.pipeline, {
      collectionResolver: name => this.db.getCollectionData(name),
    }) as T[]
  }
}
