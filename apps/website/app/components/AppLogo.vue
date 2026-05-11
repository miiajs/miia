<script setup lang="ts">
/**
 * Miia "Portal" wordmark.
 * Mark is a rounded gradient square holding the two `i`s of Miia
 * rendered as parallel beams with glowing dots - the brand's signature.
 */
defineProps<{
  /** Hide wordmark and show only the mark */
  markOnly?: boolean
}>()

// SSR-safe unique id, prevents hydration mismatch
const gradientId = `miia-grad-${useId()}`
</script>

<template>
  <span class="inline-flex items-center gap-2.5 font-display font-bold tracking-tight">
    <!-- Mark -->
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      class="h-7 w-7 shrink-0 drop-shadow-[0_0_18px_color-mix(in_oklab,var(--color-plasma-500)_45%,transparent)]"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ff4d6d" />
          <stop offset="0.55" stop-color="#7c3aed" />
          <stop offset="1" stop-color="#22d3ee" />
        </linearGradient>
      </defs>

      <!-- Portal frame -->
      <rect
        x="0.75" y="0.75" width="30.5" height="30.5" rx="8"
        :fill="`url(#${gradientId})`"
      />
      <!-- Inner dark well so beams read crisply -->
      <rect
        x="3" y="3" width="26" height="26" rx="6"
        fill="rgba(10,10,18,0.92)"
      />

      <!-- Left beam -->
      <circle cx="12" cy="9" r="2" fill="white" />
      <rect x="10.5" y="12.5" width="3" height="13.5" rx="1.5" fill="white" />

      <!-- Right beam -->
      <circle cx="20" cy="9" r="2" fill="white" />
      <rect x="18.5" y="12.5" width="3" height="13.5" rx="1.5" fill="white" />

      <!-- Connecting top ridge (subtle portal arc) -->
      <path
        d="M9.5 6.8 C 13 4.6, 19 4.6, 22.5 6.8"
        stroke="white" stroke-width="1" stroke-linecap="round"
        fill="none" opacity="0.35"
      />
    </svg>

    <!-- Wordmark -->
    <span v-if="!markOnly" class="text-xl leading-none">
      <span>m</span><span class="text-plasma">ii</span><span>a</span>
      <span class="ml-0.5 text-[0.6em] font-medium opacity-60 tracking-widest uppercase">/js</span>
    </span>
  </span>
</template>
