<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  date?: string
  path?: string
  tag?: string
}>()

const c = BRAND_COLORS
</script>

<template>
  <div
    style="display: flex; flex-direction: column; width: 100%; height: 100%; font-family: 'IBM Plex Sans';"
    :style="{ backgroundColor: c.paper, color: c.ink }"
  >
    <div
      style="display: flex; align-items: center; justify-content: space-between; padding: 30px 64px;"
      :style="{ borderBottom: `1px solid ${c.border}` }"
    >
      <div style="display: flex; align-items: center; gap: 16px;">
        <svg
          viewBox="0 0 32 32"
          width="52"
          height="52"
        >
          <rect
            x="1.5"
            y="1.5"
            width="29"
            height="29"
            rx="7"
            fill="none"
            :stroke="c.ink"
            stroke-width="2"
          />
          <g transform="translate(16 16) scale(0.8) translate(-16 -16)">
            <rect
              x="10"
              y="13"
              width="3.6"
              height="13"
              rx="1.8"
              :fill="c.ink"
            />
            <circle
              cx="11.8"
              cy="8.4"
              r="2.3"
              :fill="c.accent"
            />
            <rect
              x="18.4"
              y="13"
              width="3.6"
              height="13"
              rx="1.8"
              :fill="c.ink"
            />
            <circle
              cx="20.2"
              cy="8.4"
              r="2.3"
              :fill="c.accent"
            />
          </g>
        </svg>
        <div style="display: flex; font-size: 32px; font-weight: 600; letter-spacing: -0.01em;">
          <span>miia</span>
          <span
            style="font-weight: 400;"
            :style="{ color: c.textDimmed }"
          >/js</span>
        </div>
      </div>
      <span
        style="font-family: 'IBM Plex Mono'; font-size: 22px; font-weight: 400;"
        :style="{ color: c.textMuted }"
      >
        {{ tag ? `blog · ${tag}` : 'blog' }}
      </span>
    </div>

    <div style="display: flex; flex-direction: column; justify-content: center; flex-grow: 1; gap: 26px; padding: 0 64px;">
      <span style="font-size: 66px; font-weight: 600; line-height: 1.1; letter-spacing: -0.025em; line-clamp: 3; text-overflow: ellipsis; overflow: hidden;">
        {{ title }}
      </span>
      <span
        v-if="description"
        style="font-size: 28px; font-weight: 400; line-height: 1.5; line-clamp: 2; text-overflow: ellipsis; overflow: hidden;"
        :style="{ color: c.textToned }"
      >
        {{ description }}
      </span>
    </div>

    <div
      style="display: flex; justify-content: space-between; padding: 24px 64px; font-family: 'IBM Plex Mono'; font-size: 22px; font-weight: 400;"
      :style="{ borderTop: `1px solid ${c.border}`, color: c.textMuted }"
    >
      <span>miiajs.com{{ path || '/blog' }}</span>
      <span v-if="date">{{ date }}</span>
    </div>
  </div>
</template>
