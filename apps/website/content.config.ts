import { defineCollection, z } from '@nuxt/content'

// Blog drafts (*.draft.md) exist only in `nuxt dev`: the prerendered SQL dump holds every matched file
const isDev = process.env.NODE_ENV === 'development'

const text = z.string().nonempty()

const section = z.object({
  title: text,
  description: text
})

const textLink = z.object({
  label: text,
  to: text
})

const buttonLink = textLink.extend({
  target: z.literal('_blank').optional(),
  icon: text.optional(),
  trailing: z.boolean().optional(),
  variant: z.literal('outline').optional()
})

export const collections = {
  index: defineCollection({
    source: '0.index.yml',
    type: 'page',
    schema: z.object({
      hero: section.extend({
        links: z.array(buttonLink)
      }),
      architecture: section.extend({
        link: textLink,
        features: z.array(section).length(3)
      }),
      runtimes: section.extend({
        tested: z.array(text)
      }),
      packages: section.extend({
        link: textLink,
        items: z.array(section.extend({
          packages: text
        }))
      }),
      performance: section.extend({
        link: textLink
      }),
      start: section.extend({
        links: z.array(buttonLink)
      })
    })
  }),
  docs: defineCollection({
    source: '1.docs/**/*',
    type: 'page',
    schema: z.object({
      title: z.string().nonempty(),
      description: z.string().nonempty(),
      status: z.enum(['experimental']).optional()
    })
  }),
  blog: defineCollection({
    source: {
      include: '2.blog/*.md',
      exclude: isDev ? [] : ['2.blog/*.draft.md']
    },
    type: 'page',
    schema: z.object({
      title: z.string().nonempty(),
      description: z.string().nonempty(),
      date: z.date(),
      author: z.string().nonempty(),
      tags: z.array(z.string()).default([]),
      topics: z.array(z.string()).optional(),
      discussion: z.string().url().optional()
    })
  })
}
