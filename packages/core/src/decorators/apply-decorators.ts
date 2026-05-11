type MethodDecorator = (value: any, context: ClassMethodDecoratorContext) => any

/**
 * Compose multiple method decorators into a single one.
 *
 * Each passed decorator runs with the same target and context, so all
 * side-effects on `context.metadata` accumulate naturally. Useful for
 * building higher-level decorators (e.g. `Admin = applyDecorators(UseGuard(...), Status(200))`)
 * without re-implementing metadata writes by hand.
 *
 * Order matches argument order: the first decorator in the list runs first.
 * If a decorator returns a replacement function, subsequent decorators
 * receive the replacement.
 *
 * Currently method-level only. For class-level composition, stack decorators
 * directly or add a dedicated helper later.
 */
export function applyDecorators(
  ...decorators: MethodDecorator[]
): <V extends Function>(value: V, context: ClassMethodDecoratorContext) => V | void {
  return (value, context) => {
    let current: any = value
    for (const decorator of decorators) {
      const result = decorator(current, context)
      if (typeof result === 'function') current = result
    }
    return current
  }
}
