/** The client-side surface this page needs; declared here so the bundle depends on no Harness package. */

export type Translate = (key: string) => string

export interface SlotRegistration {
  name: string
  id: string
  order?: number
  label?: () => string
  locale?: string
  inject?: () => Record<string, unknown>
}

export interface ClientContext {
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
    bind(namespace: string): Translate
  }
  slots: {
    inject(key: string, callback: () => unknown): void
    register(options: SlotRegistration, component: unknown): unknown
  }
  effect(callback: () => void | (() => void), label?: string): void
}
