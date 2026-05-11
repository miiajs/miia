export interface BenchRow {
  framework: string
  reqSec: number
  latency: string
  highlight?: boolean
}

export interface BenchDataset {
  syntheticGet: BenchRow[]
  syntheticPost: BenchRow[]
  apiGet: BenchRow[]
  apiPost: BenchRow[]
}

export interface EnvConfig {
  key: string
  label: string
  description: string
  icon: string
  specs: string[]
}
