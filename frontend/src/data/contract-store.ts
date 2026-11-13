import { SEED_CONTRACT_STORE, type ContractStore } from './dws-contract'

// 汇总层契约的本地持久化：与业务模块数据分开存放，互不影响。
const STORAGE_KEY = 'data-layer-studio:dws-contracts'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seed(): ContractStore {
  return clone(SEED_CONTRACT_STORE)
}

function write(store: ContractStore): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }
}

function readStorage(): ContractStore {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seed()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = seed()
    write(initial)
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ContractStore>
    return {
      published: parsed.published ?? [],
      bindings: parsed.bindings ?? [],
      pending: parsed.pending ?? {},
      compat: parsed.compat ?? [],
      upstreamOverrides: parsed.upstreamOverrides ?? {},
    }
  } catch {
    const initial = seed()
    write(initial)
    return initial
  }
}

let cache: ContractStore | null = null
const listeners = new Set<() => void>()

export function contractState(): ContractStore {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveContractState(next: ContractStore): void {
  cache = next
  write(next)
  for (const listener of listeners) {
    listener()
  }
}

/** 订阅契约状态变化，返回取消订阅函数。 */
export function subscribeContractState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetContractState(): ContractStore {
  const next = seed()
  saveContractState(next)
  return next
}

export function contractStorageKey(): string {
  return STORAGE_KEY
}
