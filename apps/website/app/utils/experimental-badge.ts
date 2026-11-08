import type { BadgeProps } from '@nuxt/ui'

// The only maturity mark the docs show, in the sidebar and in the page header
export const EXPERIMENTAL_BADGE: BadgeProps = {
  label: 'experimental',
  color: 'neutral',
  variant: 'outline',
  size: 'sm',
  class: 'rounded-[3px] border border-dashed border-(--ui-text-dimmed) bg-transparent px-[5px] py-0 font-mono text-[11px]/4 font-normal text-toned ring-0'
}
