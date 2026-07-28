import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import mingo from 'mingo'
import { ReadPreference, type CursorFlag, type Document, type MongoDBNamespace, type ReadConcernLike, type ReadPreferenceLike, type Sort } from 'mongodb'
import { MockMongoDb } from '.'
import { clone } from './misc'

export class AggregationCursor<T = Record<string, unknown>> extends EventEmitter {
  readonly pipeline: object[]
  #buffer?: T[]
  #index = 0
  #closed = false
  #emittedClose = false

  constructor(
    private readonly documents: object[],
    pipeline: object[],
    private readonly db: MockMongoDb,
    private readonly mapper?: (document: unknown) => T,
  ) {
    super()
    this.pipeline = [...pipeline]
  }

  get id() {
    return undefined
  }

  get namespace(): MongoDBNamespace {
    return {
      db: 'mock',
      collection: 'aggregate',
      toString: () => 'mock.aggregate',
      withCollection: collection => ({
        db: 'mock',
        collection,
        toString: () => `mock.${collection}`,
        withCollection: nextCollection => this.namespace.withCollection(nextCollection),
      }),
    } as MongoDBNamespace
  }

  get readPreference() {
    return ReadPreference.primary
  }

  get readConcern() {
    return undefined
  }

  get closed() {
    return this.#closed
  }

  get killed() {
    return false
  }

  get loadBalanced() {
    return false
  }

  clone() {
    return new AggregationCursor<T>(this.documents, this.pipeline, this.db, this.mapper)
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  async explain() {
    return {
      ok: 1,
      mock: true,
      pipeline: clone(this.pipeline),
    }
  }

  async toArray(): Promise<T[]> {
    const documents = this.evaluate().slice(this.#index)
    this.#index = this.evaluate().length
    return clone(documents)
  }

  async next(): Promise<T | null> {
    if (this.#closed)
      return null

    const documents = this.evaluate()
    if (this.#index >= documents.length)
      return null

    return clone(documents[this.#index++])
  }

  async tryNext() {
    return this.next()
  }

  async hasNext() {
    return !this.#closed && this.#index < this.evaluate().length
  }

  bufferedCount() {
    if (this.#closed)
      return 0
    return Math.max(0, this.evaluate().length - this.#index)
  }

  readBufferedDocuments(count = this.bufferedCount()) {
    if (this.#closed)
      return []

    const documents = this.evaluate().slice(this.#index, this.#index + count)
    this.#index += documents.length
    return clone(documents) as NonNullable<T>[]
  }

  stream() {
    return Readable.from(this) as Readable & AsyncIterable<T>
  }

  async forEach(callback: (document: T) => boolean | void | Promise<boolean | void>) {
    while (await this.hasNext()) {
      const document = await this.next()
      if (document === null)
        return
      const result = await callback(document)
      if (result === false)
        return
    }
  }

  async close(_options?: { timeoutMS?: number }) {
    this.#closed = true
    if (!this.#emittedClose) {
      this.#emittedClose = true
      this.emit('close')
    }
  }

  map<R>(mapper: (document: T) => R): AggregationCursor<R> {
    const mapped = new AggregationCursor<R>(
      this.documents,
      this.pipeline,
      this.db,
      document => mapper(this.applyMapper(document)),
    )
    mapped.#index = this.#index
    mapped.#closed = this.#closed
    return mapped
  }

  rewind() {
    this.#index = 0
    this.#closed = false
  }

  addStage(stage: Document): this
  addStage<R = Document>(stage: Document): AggregationCursor<R>
  addStage(stage: object) {
    this.pipeline.push(stage)
    this.resetEvaluation()
    return this
  }

  group<R = T>($group: object): AggregationCursor<R> {
    return this.addStage<R>({ $group })
  }

  limit($limit: number): this {
    return this.addStage({ $limit })
  }

  match($match: Document): this {
    return this.addStage({ $match })
  }

  project<R extends object = Record<string, unknown>>($project: object): AggregationCursor<R> {
    return this.addStage<R>({ $project })
  }

  lookup($lookup: Document): this {
    return this.addStage({ $lookup })
  }

  skip($skip: number): this {
    return this.addStage({ $skip })
  }

  sort($sort: Sort): this {
    return this.addStage({ $sort })
  }

  unwind($unwind: Document | string): this {
    return this.addStage({ $unwind })
  }

  out($out: { db: string; coll: string } | string): this {
    return this.addStage({ $out })
  }

  redact($redact: Document): this {
    return this.addStage({ $redact })
  }

  geoNear(_geoNear: object): never {
    throw new Error('AggregationCursor.geoNear is not implemented')
  }

  batchSize(_value: number): this {
    return this
  }

  maxTimeMS(_value: number): this {
    return this
  }

  addCursorFlag(_flag: CursorFlag, _value: boolean): this {
    return this
  }

  withReadPreference(_readPreference: ReadPreferenceLike): this {
    return this
  }

  withReadConcern(_readConcern: ReadConcernLike): this {
    return this
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    while (await this.hasNext()) {
      const document = await this.next()
      if (document !== null)
        yield document
    }
  }

  private evaluate() {
    if (this.#buffer)
      return this.#buffer

    const returnsNoDocuments = this.pipeline.some(stage => Object.hasOwn(stage, '$out'))
    const documents = mingo.aggregate(this.documents as never, this.pipeline as never, {
      collectionResolver: name => this.db.getCollectionData(name),
    }) as unknown[]

    this.#buffer = returnsNoDocuments
      ? []
      : documents
          .filter(document => document !== undefined)
          .map(document => this.applyMapper(document))

    return this.#buffer
  }

  private applyMapper(document: unknown): T {
    return this.mapper ? this.mapper(document) : document as T
  }

  private resetEvaluation() {
    this.#buffer = undefined
    this.#index = 0
  }
}
