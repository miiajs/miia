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
  date: string
  versions: { bun: string, deno: string, node: string }
  specs: string[]
}
