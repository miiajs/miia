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
    // Shared by the docs sidebar and the mobile docs menu; the current page gets a tinted row and the accent square
    contentNavigation: {
      slots: {
        list: 'mx-0 mt-0',
        listWithChildren: 'ms-2.5',
        itemWithChildren: 'data-[state=open]:mb-1',
        trigger: 'font-normal text-toned hover:text-highlighted data-[state=open]:font-medium data-[state=open]:text-highlighted',
        link: 'gap-2 py-1.5 text-[14.5px] leading-5 before:rounded-[4px]',
        // Wraps instead of truncating: the current page's marker and an experimental badge do not fit one line in the sidebar
        linkTitle: 'text-clip',
        linkTrailing: 'gap-2',
        linkTrailingIcon: 'size-3.5 group-data-[state=open]:rotate-90'
      },
      variants: {
        active: {
          false: {
            link: 'text-toned'
          }
        }
      },
      compoundVariants: [{
        variant: 'pill',
        active: true,
        highlight: false,
        class: {
          link: 'font-semibold text-highlighted before:bg-black/5 dark:before:bg-white/7'
        }
      }]
    },
    contentToc: {
      slots: {
        root: 'lg:mx-0 lg:px-0',
        container: 'lg:pt-10',
        trigger: 'mb-1.5 font-mono text-xs font-normal text-muted lowercase',
        listWithChildren: 'ms-3.5',
        link: 'py-1 text-[13.5px] leading-[1.45]'
      },
      variants: {
        active: {
          true: {
            link: 'font-semibold before:me-2 before:size-[5px] before:shrink-0 before:bg-primary before:content-[\'\']'
          },
          false: {
            link: 'ps-[13px]'
          }
        }
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
        base: 'inline rounded-[4px] px-[0.4em] py-[0.12em] text-[0.86em] font-normal box-decoration-clone',
        variants: {
          color: {
            neutral: 'border-0 bg-black/5 dark:bg-white/7 text-highlighted'
          }
        }
      },
      p: {
        base: 'my-[18px] leading-[1.7] lg:my-[22px]'
      },
      li: {
        base: 'leading-[1.7]'
      },
      a: {
        base: 'border-b-0 font-normal underline decoration-1 underline-offset-[0.2em] hover:decoration-2'
      },
      h2: {
        slots: {
          base: 'mt-[30px] mb-[18px] text-[22px] leading-[1.25] font-semibold tracking-[-0.01em] lg:mt-10 lg:mb-[22px] lg:text-[26px] lg:tracking-[-0.015em] [&>a>code]:text-[0.86em] [&>a>code]:font-semibold'
        }
      },
      h3: {
        slots: {
          base: 'mt-8 mb-3 text-lg leading-snug font-semibold tracking-[-0.01em] lg:text-xl [&>a>code]:text-[0.86em] [&>a>code]:font-semibold'
        }
      },
      h4: {
        slots: {
          base: 'text-base font-semibold lg:text-[17px]'
        }
      },
      // The frame scrolls sideways on narrow screens; a column floor keeps a three-column table from squeezing into a phone
      table: {
        slots: {
          root: 'rounded-[8px] border border-default bg-elevated',
          base: 'border-collapse rounded-none text-sm leading-[1.55] lg:text-[14.5px]'
        }
      },
      thead: {
        base: 'bg-transparent'
      },
      th: {
        base: 'min-w-32 border-0 first:border-s-0 px-3.5 py-2.5 font-mono text-xs font-normal text-muted lowercase lg:px-4 lg:py-3 [&_code]:normal-case'
      },
      td: {
        base: 'min-w-32 border-0 first:border-s-0 border-t border-muted px-3.5 py-2.5 text-sm leading-[1.55] lg:px-4 lg:py-3 lg:text-[14.5px] [&_code]:text-[0.86em]'
      }
    }
  }
})
