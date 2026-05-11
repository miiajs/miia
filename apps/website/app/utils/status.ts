export type PackageStatus = 'experimental' | 'beta' | 'stable'

export function statusColor(status: PackageStatus): 'warning' | 'info' | 'success' {
  switch (status) {
    case 'experimental': return 'warning'
    case 'beta': return 'info'
    case 'stable': return 'success'
  }
}
