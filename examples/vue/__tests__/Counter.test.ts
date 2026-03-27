import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Counter from '../src/Counter.vue'

describe('Counter', () => {
  // --- initial state ---

  it('starts at 0', () => {
    const wrapper = mount(Counter)
    expect(wrapper.find('[data-testid="count"]').text()).toBe('0')
  })

  it('does not show positive message at zero', () => {
    const wrapper = mount(Counter)
    // Kills vIfNegate: v-if="!(isPositive)" would show the message when count=0
    expect(wrapper.find('[data-testid="positive-msg"]').exists()).toBe(false)
  })

  it('does not show large message at zero', () => {
    const wrapper = mount(Counter)
    expect(wrapper.find('[data-testid="large-msg"]').exists()).toBe(false)
  })

  // --- increment ---

  it('increments count on click', async () => {
    const wrapper = mount(Counter)
    await wrapper.find('[data-testid="increment"]').trigger('click')
    // Kills computedToRef: ref(() => count.value * 2) would make doubled a
    // function rather than a reactive number, breaking the template binding
    expect(wrapper.find('[data-testid="count"]').text()).toBe('1')
  })

  it('shows positive message after incrementing', async () => {
    const wrapper = mount(Counter)
    await wrapper.find('[data-testid="increment"]').trigger('click')
    // Kills vIfNegate: v-if="!(isPositive)" would hide the message when count=1
    expect(wrapper.find('[data-testid="positive-msg"]').exists()).toBe(true)
  })

  it('shows doubled label when doubled exceeds 5', async () => {
    const wrapper = mount(Counter)
    // Increment 3 times: count=3, doubled=6 > 5
    await wrapper.find('[data-testid="increment"]').trigger('click')
    await wrapper.find('[data-testid="increment"]').trigger('click')
    await wrapper.find('[data-testid="increment"]').trigger('click')
    // Kills vShowNegate: v-show="!(doubled > 5)" would hide the label when doubled=6
    expect(wrapper.find('[data-testid="doubled-label"]').isVisible()).toBe(true)
  })

  it('hides doubled label when doubled is 5 or less', async () => {
    const wrapper = mount(Counter)
    await wrapper.find('[data-testid="increment"]').trigger('click')
    await wrapper.find('[data-testid="increment"]').trigger('click')
    expect(wrapper.find('[data-testid="doubled-label"]').isVisible()).toBe(false)
  })

  it('shows large message at count 6', async () => {
    const wrapper = mount(Counter)
    for (let i = 0; i < 6; i++) {
      await wrapper.find('[data-testid="increment"]').trigger('click')
    }
    // count=6 >= 5, so isLarge is true. Kills vIfNegate on isLarge.
    expect(wrapper.find('[data-testid="large-msg"]').exists()).toBe(true)
  })

  it('does not show large message at count 4', async () => {
    const wrapper = mount(Counter)
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-testid="increment"]').trigger('click')
    }
    // count=4 < 5, so isLarge is false.
    expect(wrapper.find('[data-testid="large-msg"]').exists()).toBe(false)
  })

  // --- decrement ---

  it('decrement button is disabled at zero', () => {
    const wrapper = mount(Counter)
    // Kills vBindNegate on :disabled — !(count <= 0) would be false at count=0,
    // leaving the button enabled when it should be disabled.
    const btn = wrapper.find('[data-testid="decrement"]').element as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('decrements count after incrementing', async () => {
    const wrapper = mount(Counter)
    await wrapper.find('[data-testid="increment"]').trigger('click')
    await wrapper.find('[data-testid="increment"]').trigger('click')
    await wrapper.find('[data-testid="decrement"]').trigger('click')
    expect(wrapper.find('[data-testid="count"]').text()).toBe('1')
  })

  // --- surviving mutant ---
  // relaxGE changes computed(() => count.value >= 5) to computed(() => count.value > 5).
  // Tests only probe count=6 (large) and count=4 (not large) — never count=5.
  // At count=5 the two expressions diverge, but no test checks that boundary,
  // so the relaxGE mutant survives.
  // Uncomment the test below to kill it:
  // it('shows large message at count 5', async () => {
  //   const wrapper = mount(Counter)
  //   for (let i = 0; i < 5; i++) {
  //     await wrapper.find('[data-testid="increment"]').trigger('click')
  //   }
  //   expect(wrapper.find('[data-testid="large-msg"]').exists()).toBe(true)
  // })
})
