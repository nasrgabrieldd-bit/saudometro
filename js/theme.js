const KEY = "saudometro-theme";

function isDarkNow() {
  const saved = document.documentElement.getAttribute("data-theme");
  if (saved) return saved === "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function updateIcons() {
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.textContent = isDarkNow() ? "☀️" : "🌙";
  });
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  } catch (e) { /* localStorage indisponível: segue o tema do sistema */ }
  updateIcons();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = isDarkNow() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ok, só não persiste */ }
      updateIcons();
    });
  });
}
