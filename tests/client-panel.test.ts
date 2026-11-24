import { describe, expect, it } from 'vitest'
import { NS, PANEL_ID, apply } from '../src/client/index.js'

interface Registered {
  options: {
    name: string
    id: string
    key?: string
    order?: number
    label?: () => string
    locale?: string
  }
  component: unknown
}

/** The client context, recording what the page asked the slots for. */
function fakeClient() {
  const registrations: Registered[] = []
  const injected: string[] = []
  const dictionaries: Record<string, unknown>[] = []
  const ctx = {
    locale: {
      register: (namespace: string, entries: unknown) => {
        dictionaries.push({ namespace, entries })
        return () => undefined
      },
      bind: (namespace: string) => (key: string) => `${namespace}.${key}`,
    },
    slots: {
      inject: (key: string, callback: () => unknown) => {
        injected.push(key)
        callback()
      },
      register: (options: Registered['options'], component: unknown) => {
        registrations.push({ options, component })
        return () => undefined
      },
    },
    effect: (callback: () => void | (() => void)) => {
      callback()
    },
  }
  return { ctx, registrations, injected, dictionaries }
}

describe('the MCP page registration', () => {
  it('registers the sidebar row and the page under the same id', () => {
    const { ctx, registrations, injected } = fakeClient()
    apply(ctx as never)

    expect(injected).toEqual(['sidebar.panellist', 'main'])
    const list = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
    const main = registrations.find((entry) => entry.options.name === 'main')
    expect(list?.options.id).toBe(PANEL_ID)
    expect(main?.options.key).toBe(PANEL_ID)
    expect(list?.options.order).toBe(20)
    expect(list?.options.locale).toBe(NS)
  })

  it('labels the row MCP in both languages', () => {
    const { ctx, registrations, dictionaries } = fakeClient()
    apply(ctx as never)
    const list = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
    expect(list?.options.label?.()).toBe(`${NS}.panel`)

    const registered = dictionaries[0] as { entries: { en: Record<string, string>; zh: Record<string, string> } }
    expect(registered.entries.en['panel']).toBe('MCP')
    expect(registered.entries.zh['panel']).toBe('MCP')
    expect(registered.entries.zh['title']).toBe('MCP 管理')
  })

  it('renders a component for both registrations', () => {
    const { ctx, registrations } = fakeClient()
    apply(ctx as never)
    for (const registration of registrations) expect(typeof registration.component).toBe('function')
  })

  it('no longer registers a settings tab', () => {
    const { ctx, injected } = fakeClient()
    apply(ctx as never)
    expect(injected).not.toContain('settings.plugins.tab')
  })
})
