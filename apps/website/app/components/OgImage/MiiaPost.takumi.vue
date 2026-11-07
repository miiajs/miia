<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  date?: string
}>()
</script>

<template>
  <div style="position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; background-color: #0a0a12; color: #ffffff; font-family: 'Inter';">
    <div style="position: absolute; top: -320px; right: -240px; display: flex; width: 860px; height: 860px; background-image: radial-gradient(circle, rgba(192, 75, 255, 0.32) 0%, rgba(124, 58, 237, 0.12) 40%, rgba(10, 10, 18, 0) 70%);" />
    <div style="position: absolute; bottom: -360px; left: -260px; display: flex; width: 760px; height: 760px; background-image: radial-gradient(circle, rgba(34, 211, 238, 0.14) 0%, rgba(10, 10, 18, 0) 65%);" />
    <div style="display: flex; width: 100%; height: 8px; background-image: linear-gradient(90deg, #ff4d6d 0%, #c04bff 40%, #7c3aed 70%, #22d3ee 100%);" />

    <div style="display: flex; flex-direction: column; justify-content: space-between; flex-grow: 1; padding: 64px 80px 72px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 18px;">
          <div style="display: flex; width: 44px; height: 44px; border-radius: 12px; background-image: linear-gradient(135deg, #ff4d6d 0%, #c04bff 50%, #22d3ee 100%);" />
          <span style="font-family: 'Space Grotesk'; font-size: 38px; font-weight: 700; letter-spacing: -0.02em;">
            MiiaJS
          </span>
        </div>
        <span style="font-size: 26px; font-weight: 500; color: #a1a1b5;">
          miiajs.com/blog
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 24px;">
        <span style="font-family: 'Space Grotesk'; font-size: 64px; font-weight: 700; line-height: 1.1; letter-spacing: -0.03em; line-clamp: 3; text-overflow: ellipsis; overflow: hidden;">
          {{ title }}
        </span>
        <span
          v-if="description"
          style="font-size: 28px; font-weight: 400; line-height: 1.45; color: #b4b4c7; line-clamp: 2; text-overflow: ellipsis; overflow: hidden;"
        >
          {{ description }}
        </span>
      </div>

      <div style="display: flex; align-items: center; gap: 20px;">
        <div style="display: flex; width: 56px; height: 4px; border-radius: 2px; background-image: linear-gradient(90deg, #ff4d6d 0%, #22d3ee 100%);" />
        <span style="font-size: 26px; font-weight: 500; color: #a1a1b5;">
          {{ date || 'Blog' }}
        </span>
      </div>
    </div>
  </div>
</template>
