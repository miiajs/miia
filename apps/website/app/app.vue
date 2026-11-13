<script setup lang="ts">
useSiteHead()
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator
      color="var(--ui-primary)"
      :height="3"
      :throttle="150"
    />

    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <AppSearch />
  </UApp>
</template>
