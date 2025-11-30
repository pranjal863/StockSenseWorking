// Smooth scroll for navigation links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault()
    const target = document.querySelector(this.getAttribute("href"))
    if (target) {
      target.scrollIntoView({
        block: "start",
        behavior: "smooth",
      })
    }
  })
})

// Button ripple effect
document.querySelectorAll(".primary-btn, .cta-button").forEach((button) => {
  button.addEventListener("click", function (e) {
    const ripple = document.createElement("span")
    const rect = this.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const x = e.clientX - rect.left - size / 2
    const y = e.clientY - rect.top - size / 2

    ripple.style.width = ripple.style.height = size + "px"
    ripple.style.left = x + "px"
    ripple.style.top = y + "px"
    ripple.style.position = "absolute"
    ripple.style.borderRadius = "50%"
    ripple.style.background = "rgba(255,255,255,0.5)"
    ripple.style.pointerEvents = "none"
    ripple.style.animation = "ripple-animation 0.6s ease-out"

    this.style.position = "relative"
    this.style.overflow = "hidden"
    this.appendChild(ripple)

    setTimeout(() => ripple.remove(), 600)
  })
})

// Scroll animation for stats cards
const observerOptions = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px",
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.style.animation = entry.target.dataset.animation || "fadeInUp 0.8s ease forwards"
      observer.unobserve(entry.target)
    }
  })
}, observerOptions)

document.querySelectorAll(".feature-card").forEach((card, index) => {
  card.dataset.animation = `fadeInUp 0.8s ease forwards ${index * 0.1}s`
  card.style.opacity = "0"
  observer.observe(card)
})

// Scroll stat cards animation
document.querySelectorAll(".callout-item").forEach((item, index) => {
  item.dataset.animation = `fadeInUp 0.8s ease forwards ${index * 0.1}s`
  item.style.opacity = "0"
  observer.observe(item)
})

document.querySelectorAll(".about-card").forEach((card, index) => {
  card.dataset.animation = `fadeInUp 0.8s ease forwards ${index * 0.1}s`
  card.style.opacity = "0"
  observer.observe(card)
})

// Auto-loop for scrollable stats - pause on hover
const statsTrack = document.querySelector(".stats-track")
if (statsTrack) {
  statsTrack.addEventListener("mouseenter", () => {
    statsTrack.style.animationPlayState = "paused"
  })

  statsTrack.addEventListener("mouseleave", () => {
    statsTrack.style.animationPlayState = "running"
  })
}

document.querySelectorAll(".feature-icon svg").forEach((svg) => {
  svg.setAttribute("width", "24")
  svg.setAttribute("height", "24")
})

document.querySelectorAll(".callout-icon svg").forEach((svg) => {
  svg.setAttribute("width", "48")
  svg.setAttribute("height", "48")
})


const themeToggle = document.getElementById("themeToggle")
const html = document.documentElement

// Initialize theme from localStorage or system preference
const initializeTheme = () => {
  const savedTheme = localStorage.getItem("theme") || "light"
  html.setAttribute("data-theme", savedTheme)
  updateThemeIcon(savedTheme)
}

// Update icon based on theme
const updateThemeIcon = (theme) => {
  const icon = themeToggle.querySelector("i")
  if (theme === "dark") {
    icon.classList.remove("fa-moon")
    icon.classList.add("fa-sun")
  } else {
    icon.classList.remove("fa-sun")
    icon.classList.add("fa-moon")
  }
}

// Toggle theme
themeToggle.addEventListener("click", () => {
  const currentTheme = html.getAttribute("data-theme") || "light"
  const newTheme = currentTheme === "light" ? "dark" : "light"

  html.setAttribute("data-theme", newTheme)
  localStorage.setItem("theme", newTheme)
  updateThemeIcon(newTheme)
})

// Initialize theme on page load
initializeTheme()


// Scroll spy: highlight active nav link when section is in view
;(function setupScrollSpy() {
  const sectionIds = ["features", "about"]
  const sections = sectionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean)
  const navLinks = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'))

  if (!sections.length || !navLinks.length) return

  const spyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const id = entry.target.id
        const link = document.querySelector(`.nav-links a[href="#${id}"]`)
        if (entry.isIntersecting && link) {
          navLinks.forEach((l) => l.classList.remove("active"))
          link.classList.add("active")
        }
      })
    },
    {
      // Center-based detection for smoother activation
      root: null,
      threshold: 0.5,
    }
  )

  sections.forEach((section) => spyObserver.observe(section))
})()
