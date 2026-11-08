// Code block themes: ink text, decorators in the accent, strings and comments muted.
// The colors mirror the theme variables in app/assets/css/main.css
interface Palette {
  ink: string
  accent: string
  muted: string
  bg: string
}

function codeTheme(name: string, type: 'light' | 'dark', { ink, accent, muted, bg }: Palette) {
  return {
    name,
    type,
    fg: ink,
    bg,
    settings: [
      { settings: { foreground: ink, background: bg } },
      {
        scope: ['comment', 'punctuation.definition.comment', 'string', 'punctuation.definition.string'],
        settings: { foreground: muted }
      },
      {
        scope: ['string.unquoted', 'meta.template.expression', 'support.type.property-name'],
        settings: { foreground: ink }
      },
      {
        scope: ['meta.decorator punctuation.decorator', 'meta.decorator entity.name.function'],
        settings: { foreground: accent }
      }
    ]
  }
}

export const miiaLight = codeTheme('miia-light', 'light', { ink: '#18181B', accent: '#2B4ACB', muted: '#5F5C55', bg: '#FBFAF7' })
export const miiaDark = codeTheme('miia-dark', 'dark', { ink: '#ECEAE4', accent: '#7C93FF', muted: '#A3A098', bg: '#1D1D20' })
