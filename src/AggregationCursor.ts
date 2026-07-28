import mingo from 'mingo'
import { MockMongoDb } from '.'
import { clone } from './misc'

export class AggregationCursor<T extends object = Record<string, unknown>> {
  #buffer?: T[]
  #index = 0
  #closed = false

  constructor(
    private readonly documents: object[],
    private readonly pipeline: object[],
    private readonly db: MockMongoDb,
  ) {}

  async toArray() {
    const documents = this.evaluate().slice(this.#index)
    this.#index = this.evaluate().length
    return clone(documents)
  }

  async next() {
    if (this.#closed)
      return null

    const document = this.evaluate()[this.#index++]
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

    this.#buffer = mingo.aggregate(this.documents as never, this.pipeline as never, {
      collectionResolver: name => this.db.getCollectionData(name),
    }) as T[]

    return this.#buffer
  }
}
