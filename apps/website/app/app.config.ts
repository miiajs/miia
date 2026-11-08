export default defineAppConfig({
  ui: {
    colors: {
      primary: 'brand',
      neutral: 'stone'
    },
    button: {
      slots: {
        base: 'font-medium'
      }
    },
    prose: {
      // The tabs sit on ProsePre (components/content) as its header row, the copy button at their end
      codeGroup: {
        slots: {
          list: 'border-default bg-elevated rounded-t-[8px] p-1 pe-12',
          indicator: 'inset-y-1 bg-accented rounded-sm shadow-none',
          trigger: 'min-h-9 font-mono text-xs text-muted hover:bg-accented/50 rounded-sm'
        }
      },
      code: {
        base: 'inline rounded-[4px] px-[0.35em] py-[0.15em] box-decoration-clone',
        variants: {
          color: {
            neutral: 'border-0 bg-black/5 dark:bg-white/7 text-highlighted'
          }
        }
      }
    }
  }
})
