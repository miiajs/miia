<script setup lang="ts">
const route = useRoute()
const navigation = useDocsNavigation()
</script>

<template>
  <div>
    <AppHeader wide />

    <DocsMobileBar :key="route.path" />

    <UMain>
      <UContainer>
        <UPage>
          <template #left>
            <UPageAside>
              <template #top>
                <UContentSearchButton :collapsed="false" />
              </template>

              <UContentNavigation
                :navigation="navigation"
                highlight
              />
            </UPageAside>
          </template>

          <slot />
        </UPage>
      </UContainer>
    </UMain>

    <AppFooter compact />
  </div>
</template>
