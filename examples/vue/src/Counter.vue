<template>
  <div>
    <p v-if="isPositive" data-testid="positive-msg">Count is positive</p>
    <p v-show="doubled > 5" data-testid="doubled-label">Doubled exceeds 5: {{ doubled }}</p>
    <p v-if="isLarge" data-testid="large-msg">Count is large!</p>
    <button :disabled="count <= 0" data-testid="decrement" @click="decrement">-</button>
    <span data-testid="count">{{ count }}</span>
    <button data-testid="increment" @click="increment">+</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const count = ref(0)
const doubled = computed(() => count.value * 2)
const isPositive = computed(() => count.value > 0)
const isLarge = computed(() => count.value >= 5)

function increment() {
  count.value++
}

function decrement() {
  count.value--
}
</script>
