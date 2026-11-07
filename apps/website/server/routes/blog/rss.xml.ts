import { queryCollection } from '@nuxt/content/server'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const site = getSiteConfig(event).url.replace(/\/$/, '')
  const posts = await queryCollection(event, 'blog')
    .select('path', 'title', 'description', 'date', 'author', 'tags')
    .order('date', 'DESC')
    .all()

  const items = posts.map((post) => {
    const link = escapeXml(`${site}${post.path}`)
    return [
      '    <item>',
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <pubDate>${new Date(post.date).toUTCString()}</pubDate>`,
      `      <description>${escapeXml(post.description)}</description>`,
      ...(post.tags ?? []).map(tag => `      <category>${escapeXml(tag)}</category>`),
      `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
      '    </item>'
    ].join('\n')
  })

  const lastBuildDate = posts[0] ? new Date(posts[0].date) : new Date()

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    '    <title>MiiaJS Blog</title>',
    `    <link>${escapeXml(`${site}/blog`)}</link>`,
    '    <description>Release notes, design decisions and guides for MiiaJS.</description>',
    '    <language>en</language>',
    `    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(`${site}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    ''
  ].join('\n')

  setHeader(event, 'content-type', 'application/rss+xml; charset=utf-8')
  return xml
})
