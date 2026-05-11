import type { Constructor } from '../types.js'

export function createClassDecorator<TArgs extends any[] = []>(
  handler: (target: Constructor, context: ClassDecoratorContext, ...args: TArgs) => void,
): (...args: TArgs) => <T extends Constructor>(target: T, context: ClassDecoratorContext<T>) => T {
  return (...args: TArgs) => {
    return <T extends Constructor>(target: T, context: ClassDecoratorContext<T>): T => {
      handler(target, context, ...args)
      return target
    }
  }
}

export function createMethodDecorator<TArgs extends any[] = []>(
  handler: (target: Function, context: ClassMethodDecoratorContext, ...args: TArgs) => void,
): (...args: TArgs) => (target: Function, context: ClassMethodDecoratorContext) => void {
  return (...args: TArgs) => {
    return (target: Function, context: ClassMethodDecoratorContext): void => {
      handler(target, context, ...args)
    }
  }
}

export function createFieldDecorator<TArgs extends any[] = []>(
  handler: (context: ClassFieldDecoratorContext, ...args: TArgs) => void,
): (...args: TArgs) => (target: undefined, context: ClassFieldDecoratorContext) => void {
  return (...args: TArgs) => {
    return (_target: undefined, context: ClassFieldDecoratorContext): void => {
      handler(context, ...args)
    }
  }
}

export function createDecorator<TArgs extends any[] = []>(
  handler: (context: ClassDecoratorContext | ClassMethodDecoratorContext, ...args: TArgs) => void,
): (...args: TArgs) => (target: any, context: ClassDecoratorContext | ClassMethodDecoratorContext) => any {
  return (...args: TArgs) => {
    return (target: any, context: ClassDecoratorContext | ClassMethodDecoratorContext): any => {
      handler(context, ...args)
      return target
    }
  }
}
