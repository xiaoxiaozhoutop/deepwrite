<script setup lang="ts">
import { computed } from "vue";
import { createScopedTranslator } from "../i18n";
import {
  parseWebFetchSummary,
  parseWebSearchSummary,
  type WebSearchSource
} from "../utils/webSearchSummary";

const props = defineProps<{ summary: string }>();
const t = createScopedTranslator("components.conversationProcessingItem");

// A search lists its results; a page read is one source of its own.
const sources = computed(() => {
  const found = parseWebSearchSummary(props.summary).sources;
  const page = parseWebFetchSummary(props.summary);
  const listed: WebSearchSource[] = found.length ? found : page ? [page] : [];
  return listed.map((source) => ({
    ...source,
    origin:
      [source.site, source.date].filter(Boolean).join(" · ") ||
      new URL(source.url).hostname
  }));
});
</script>

<template>
  <ol
    v-if="sources.length"
    class="web-search-sources"
    :aria-label="t('webSearchSources')"
  >
    <li v-for="(source, index) in sources" :key="index">
      <a :href="source.url" target="_blank" rel="noopener noreferrer">{{
        source.title
      }}</a>
      <small>{{ source.origin }}</small>
    </li>
  </ol>
  <p v-else>{{ summary }}</p>
</template>

<style scoped>
.web-search-sources {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 1.4em;
}
.web-search-sources a {
  color: var(--accent);
  overflow-wrap: anywhere;
  text-decoration: none;
}
.web-search-sources a:hover,
.web-search-sources a:focus-visible {
  text-decoration: underline;
}
.web-search-sources small {
  display: block;
  color: var(--text-tertiary);
}
</style>
