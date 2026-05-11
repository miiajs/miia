import { config as m1Config, data as m1Data } from './m1'
import { config as serverConfig, data as serverData } from './server'
import type { BenchDataset } from './types'

export type { BenchRow, BenchDataset, EnvConfig } from './types'

export const environments = [m1Config, serverConfig]

export const datasets: Record<string, BenchDataset> = {
  [m1Config.key]: m1Data,
  [serverConfig.key]: serverData,
}
