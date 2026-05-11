<script setup lang="ts">
/**
 * Hero background.
 *
 * Layered composition:
 *   1. Fading grid texture
 *   2. Three plasma blobs that drift (keyframe animation)
 *   3. Scan-line "beam" that sweeps the full width once on mount
 *   4. Orbital ring hinting at the runtime-agnostic story
 */
const { isLoading } = useLoadingIndicator()

const appear = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    appear.value = true
  })
})
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-1000"
    :class="[appear ? 'opacity-100' : 'opacity-0', isLoading ? 'animate-pulse' : '']"
    aria-hidden="true"
  >
    <!-- Grid texture -->
    <div class="absolute inset-0 bg-grid bg-grid-fade opacity-70" />

    <!-- Plasma blobs -->
    <div class="absolute left-[8%] top-[-18%] h-[55vh] w-[55vh] will-change-transform">
      <div
        class="h-full w-full rounded-full blur-3xl animate-drift"
        style="background: radial-gradient(circle at 30% 30%, rgba(255,77,109,0.55), rgba(255,77,109,0) 70%);"
      />
    </div>
    <div class="absolute right-[6%] top-[-10%] h-[50vh] w-[50vh] will-change-transform">
      <div
        class="h-full w-full rounded-full blur-3xl animate-drift-slow"
        style="background: radial-gradient(circle at 60% 40%, rgba(124,58,237,0.55), rgba(124,58,237,0) 70%);"
      />
    </div>
    <div class="absolute left-[38%] top-[40%] h-[45vh] w-[45vh] will-change-transform">
      <div
        class="h-full w-full rounded-full blur-3xl animate-drift"
        style="background: radial-gradient(circle at 50% 50%, rgba(34,211,238,0.40), rgba(34,211,238,0) 70%); animation-delay: -6s;"
      />
    </div>

    <!-- Orbital ring (runtime-agnostic motif) -->
    <svg
      viewBox="0 0 1200 520"
      preserveAspectRatio="xMidYMid slice"
      class="absolute inset-0 h-full w-full opacity-60"
    >
      <defs>
        <linearGradient id="ring-gradient" x1="0" y1="0" x2="1200" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ff4d6d" stop-opacity="0.6" />
          <stop offset="0.5" stop-color="#7c3aed" stop-opacity="0.6" />
          <stop offset="1" stop-color="#22d3ee" stop-opacity="0.6" />
        </linearGradient>
        <linearGradient id="beam-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ff4d6d" stop-opacity="0" />
          <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.9" />
          <stop offset="1" stop-color="#22d3ee" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- Concentric rings -->
      <ellipse cx="600" cy="320" rx="560" ry="120" stroke="url(#ring-gradient)" stroke-width="1" fill="none" opacity="0.45" />
      <ellipse cx="600" cy="320" rx="420" ry="90"  stroke="url(#ring-gradient)" stroke-width="1" fill="none" opacity="0.55" />
      <ellipse cx="600" cy="320" rx="280" ry="60"  stroke="url(#ring-gradient)" stroke-width="1" fill="none" opacity="0.65" />

      <!-- Runtime nodes on the outer ring -->
      <g opacity="0.9">
        <circle cx="40"   cy="320" r="4" fill="#ff4d6d">
          <animate attributeName="r" values="3;5;3" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="1160" cy="320" r="4" fill="#22d3ee">
          <animate attributeName="r" values="3;5;3" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="600"  cy="200" r="4" fill="#7c3aed">
          <animate attributeName="r" values="3;5;3" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="600"  cy="440" r="4" fill="#c04bff">
          <animate attributeName="r" values="3;5;3" dur="2.4s" begin="1.8s" repeatCount="indefinite" />
        </circle>
      </g>

      <!-- Scan beam across the middle -->
      <rect x="0" y="318" width="1200" height="2" fill="url(#beam-gradient)" opacity="0.65">
        <animate attributeName="x" from="-1200" to="1200" dur="6s" repeatCount="indefinite" />
      </rect>
    </svg>

    <!-- Bottom fade so content below blends in (theme-aware) -->
    <div
      class="absolute inset-x-0 bottom-0 h-40"
      style="background: linear-gradient(to bottom, transparent, var(--ui-bg));"
    />
  </div>
</template>
