// New shared theme script used by both dashboard and login pages

const html = document.documentElement
const themeToggle = document.getElementById("themeToggle")

// Initialize theme from localStorage or system preference
const initializeTheme = () => {
  const savedTheme =
    localStorage.getItem("theme") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")

  html.setAttribute("data-theme", savedTheme)
  updateThemeIcon(savedTheme)
}

// Update icon based on theme
const updateThemeIcon = (theme) => {
  if (!themeToggle) return
  const icon = themeToggle.querySelector("i")
  if (!icon) return
  if (theme === "dark") {
    icon.classList.remove("fa-moon")
    icon.classList.add("fa-sun")
  } else {
    icon.classList.remove("fa-sun")
    icon.classList.add("fa-moon")
  }
}

// Toggle theme
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const currentTheme = html.getAttribute("data-theme") || "light"
    const newTheme = currentTheme === "light" ? "dark" : "light"
    html.setAttribute("data-theme", newTheme)
    localStorage.setItem("theme", newTheme)
    updateThemeIcon(newTheme)
  })
}

// Initialize theme on page load
initializeTheme()
