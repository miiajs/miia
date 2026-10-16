import { forwardRef, Injectable, Module } from '../../src/index.js'
import { CycleAModule } from './cycle-a.module.js'

@Injectable()
export class CycleBService {}

@Module({ imports: [forwardRef(() => CycleAModule)], providers: [CycleBService], exports: [CycleBService] })
export class CycleBModule {}
