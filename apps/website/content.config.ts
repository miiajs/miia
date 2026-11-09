import { defineCollection, z } from '@nuxt/content'

const colorEnum = z.enum(['primary', 'secondary', 'neutral', 'error', 'warning', 'success', 'info'])
const variantEnum = z.enum(['solid', 'outline', 'subtle', 'soft', 'ghost', 'link'])

// Blog drafts (*.draft.md) exist only in `nuxt dev`: the prerendered SQL dump holds every matched file
const isDev = process.env.NODE_ENV === 'development'

const createBaseSchema = () => z.object({
  title: z.string().nonempty(),
  description: z.string().nonempty()
})

const createLinkSchema = () => z.object({
  label: z.string().nonempty(),
  to: z.string().nonempty(),
  icon: z.string().optional().editor({ input: 'icon' }),
  trailing: z.boolean().optional(),
  target: z.string().optional(),
  color: colorEnum.optional(),
  variant: variantEnum.optional()
})

export const collections = {
  index: defineCollection({
    source: '0.index.yml',
    type: 'page',
    schema: z.object({
      hero: createBaseSchema().extend({
        links: z.array(createLinkSchema())
      }),
      architecture: createBaseSchema().extend({
        link: createLinkSchema(),
        features: z.array(createBaseSchema()).length(3)
      }),
      runtimes: createBaseSchema().extend({
        tested: z.array(z.string().nonempty())
      }),
      packages: createBaseSchema().extend({
        link: createLinkSchema(),
        items: z.array(createBaseSchema().extend({
          packages: z.string().nonempty()
        }))
      }),
      performance: createBaseSchema().extend({
        link: createLinkSchema()
      }),
      start: createBaseSchema().extend({
        links: z.array(createLinkSchema())
      })
    })
  }),
  docs: defineCollection({
    source: '1.docs/**/*',
    type: 'page',
    schema: z.object({
      title: z.string().nonempty(),
      description: z.string().nonempty(),
      status: z.enum(['experimental']).optional(),
      seo: z.object({
        title: z.string().optional(),
        description: z.string().optional()
      }).optional()
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
