import { ObjectId } from 'mongodb'

export function clone<T>(value: T): T {
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

