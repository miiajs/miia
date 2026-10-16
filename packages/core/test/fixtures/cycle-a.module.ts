import { forwardRef, Injectable, Module } from '../../src/index.js'
import { CycleBModule } from './cycle-b.module.js'

@Injectable()
export class CycleAService {}

// Each side of a file cycle wraps the other in forwardRef(): whichever file runs first sees the other in the TDZ.
@Module({ imports: [forwardRef(() => CycleBModule)], providers: [CycleAService], exports: [CycleAService] })
export class CycleAModule {}
