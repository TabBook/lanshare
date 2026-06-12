// Theme: follows the system by default, manual override persists.
export function currentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

let animTimer
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  const el = document.documentElement
  // .theme-anim turns on color transitions just for the swap, so normal
  // interactions stay snappy.
  el.classList.add('theme-anim')
  clearTimeout(animTimer)
  animTimer = setTimeout(() => el.classList.remove('theme-anim'), 400)
  el.classList.toggle('dark', next === 'dark')
  localStorage.setItem('theme', next)
  return next
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme'))
    document.documentElement.classList.toggle('dark', e.matches)
})
