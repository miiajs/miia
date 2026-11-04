export default defineAppConfig({
  ui: {
    colors: {
      primary: 'plasma',
      neutral: 'zinc'
    },
    button: {
      slots: {
        base: 'font-medium'
      }
    },
    prose: {
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
