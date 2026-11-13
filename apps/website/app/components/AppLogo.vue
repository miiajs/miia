<template>
  <span class="inline-flex items-center gap-[0.48em] text-highlighted">
    <!-- The logo follows the font size of its parent: the mark is 1.62em, the wordmark 1em -->
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      class="size-[1.62em] shrink-0"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <g transform="translate(16 16) scale(0.8) translate(-16 -16)">
        <rect
          x="10"
          y="13"
          width="3.6"
          height="13"
          rx="1.8"
          fill="currentColor"
        />
        <circle
          cx="11.8"
          cy="8.4"
          r="2.3"
          style="fill: var(--ui-primary)"
        />
        <rect
          x="18.4"
          y="13"
          width="3.6"
          height="13"
          rx="1.8"
          fill="currentColor"
        />
        <circle
          cx="20.2"
          cy="8.4"
          r="2.3"
          style="fill: var(--ui-primary)"
        />
      </g>
    </svg>
    <span class="font-semibold leading-none tracking-[-0.01em]">miia<span class="font-normal text-dimmed">/js</span></span>
  </span>
</template>
