import { describe, expect, it } from 'bun:test'
import { createToken, inject, Injectable, Miia, Module, overrideProvider, provider } from '../src/index.js'

function thrownBy(fn: () => unknown): Error {
  try {
    fn()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a throw')
}

async function initError(app: Miia): Promise<Error> {
  try {
    await app.init()
  } catch (err) {
    return err as Error
  }
  throw new Error('expected init() to fail')
}

interface Store {
  id: number
}

const CONFLICT_ADVICE =
  'a shared provider must be declared the same way in every module; use a separate token for each variant'

describe('shared providers', () => {
  it('gives every declaring module one instance, which each of them owns and exports', async () => {
    const STORE = createToken<Store>('Store')
    let built = 0
    // A new provider object per module, the way a register() call builds one
    const shared = () => provider(STORE, () => ({ id: ++built }), { shared: 'k' })

    @Injectable()
    class UserA {
      store = inject(STORE)
    }

    @Injectable()
    class UserB {
      store = inject(STORE)
    }

    @Module({ providers: [shared(), UserA], exports: [STORE] })
    class ModuleA {}

    @Module({ providers: [shared(), UserB], exports: [STORE] })
    class ModuleB {}

    @Injectable()
    class ConsumerA {
      store = inject(STORE)
    }

    @Injectable()
    class ConsumerB {
      store = inject(STORE)
    }

    @Module({ imports: [ModuleA], providers: [ConsumerA] })
    class ImporterA {}

    @Module({ imports: [ModuleB], providers: [ConsumerB] })
    class ImporterB {}

    const app = new Miia({ logger: false }).register(ImporterA, ImporterB)
    await app.init()

    expect(built).toBe(1)
    const store = app.get(STORE)
    expect(store).toEqual({ id: 1 })
    expect(app.get(UserA).store).toBe(store)
    expect(app.get(UserB).store).toBe(store)
    expect(app.get(ConsumerA).store).toBe(store)
    expect(app.get(ConsumerB).store).toBe(store)
  })

  it('rejects two declarations with different keys', () => {
    const STORE = createToken<Store>('Store')

    @Module({ providers: [provider(STORE, () => ({ id: 1 }), { shared: "connection 'default'" })] })
    class ModuleA {}

    @Module({ providers: [provider(STORE, () => ({ id: 2 }), { shared: "connection 'analytics'" })] })
    class ModuleB {}

    const app = new Miia({ logger: false }).register(ModuleA, ModuleB)

    expect(thrownBy(() => app.get(STORE)).message).toBe(
      "[Miia] Store is shared by ModuleA (connection 'default') and ModuleB (connection 'analytics') - " +
        CONFLICT_ADVICE,
    )
  })

  it('regression: rejects a shared declaration next to an unmarked one, in either order', () => {
    const STORE = createToken<Store>('Store')

    @Module({ providers: [provider(STORE, () => ({ id: 1 }), { shared: 'k' })] })
    class Marked {}

    @Module({ providers: [provider(STORE, () => ({ id: 2 }))] })
    class Unmarked {}

    const advice = "keep it in one module, add it to that module's exports, and import that module in the other"
    const markedFirst = new Miia({ logger: false }).register(Marked, Unmarked)
    expect(thrownBy(() => markedFirst.get(STORE)).message).toBe(
      `[Miia] Store is provided by both Marked and Unmarked - ${advice}`,
    )
    const unmarkedFirst = new Miia({ logger: false }).register(Unmarked, Marked)
    expect(thrownBy(() => unmarkedFirst.get(STORE)).message).toBe(
      `[Miia] Store is provided by both Unmarked and Marked - ${advice}`,
    )
  })

  it('regression: rejects a shared provider listed twice in one module', () => {
    const STORE = createToken<Store>('Store')
    const shared = provider(STORE, () => ({ id: 1 }), { shared: 'k' })

    @Module({ providers: [shared, shared] })
    class StoreModule {}

    const app = new Miia({ logger: false }).register(StoreModule)

    expect(thrownBy(() => app.get(STORE)).message).toBe('[Miia] Store is listed twice in StoreModule providers')
  })

  it('applies an override once for every declaring module and still checks the key of the next one', async () => {
    const STORE = createToken<Store>('Store')
    let built = 0
    const shared = (key: string) =>
      provider(
        STORE,
        () => {
          built++
          return { id: 1 }
        },
        { shared: key },
      )

    @Injectable()
    class UserA {
      store = inject(STORE)
    }

    @Injectable()
    class UserB {
      store = inject(STORE)
    }

    @Module({ providers: [shared('k'), UserA] })
    class ModuleA {}

    @Module({ providers: [shared('k'), UserB] })
    class ModuleB {}

    const mock = { id: 0 }
    const app = new Miia({ logger: false }).register(
      ModuleA,
      ModuleB,
      overrideProvider(STORE, () => mock),
    )
    await app.init()

    expect(built).toBe(0)
    expect(app.get(UserA).store).toBe(mock)
    expect(app.get(UserB).store).toBe(mock)

    // The key of the overridden first declaration is recorded too.
    @Module({ providers: [shared('other')] })
    class ModuleC {}

    const conflict = new Miia({ logger: false }).register(
      ModuleA,
      ModuleC,
      overrideProvider(STORE, () => mock),
    )
    expect(thrownBy(() => conflict.get(STORE)).message).toBe(
      `[Miia] Store is shared by ModuleA (k) and ModuleC (other) - ${CONFLICT_ADVICE}`,
    )
  })

  it('checks what the provider injects from every declaring module, whatever the order of imports', async () => {
    const STORE = createToken<Store>('Store')
    const X = createToken<number>('X')

    @Module({ providers: [provider(X, () => 1)], exports: [X] })
    class XModule {}

    const shared = () => provider(STORE, (resolve) => ({ id: resolve(X) }), { shared: 'k' })

    // Only ModuleA imports XModule: the factory runs once, but ModuleB declares it too and cannot see X.
    @Module({ imports: [XModule], providers: [shared()] })
    class ModuleA {}

    @Module({ providers: [shared()] })
    class ModuleB {}

    @Module({ imports: [ModuleA, ModuleB] })
    class RootAB {}

    @Module({ imports: [ModuleB, ModuleA] })
    class RootBA {}

    const ab = await initError(new Miia({ logger: false }).register(RootAB))
    const ba = await initError(new Miia({ logger: false }).register(RootBA))
    expect(ab.message).toBe(
      '[Miia] 1 module boundary violation:\n\n' +
        'Store (ModuleB) injects X (XModule):\n' +
        '  - add XModule to ModuleB `imports`\n\n' +
        'Docs: /docs/core-concepts/modules#boundaries',
    )
    expect(ba.message).toBe(ab.message)
  })
})
