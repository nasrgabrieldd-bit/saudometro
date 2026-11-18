// Comportamentos do site: menu no celular, tema claro/escuro e cópia do endereço.
(() => {
  const root = document.documentElement;
  try { const t = localStorage.getItem("saudometro-site-tema"); if (t) root.dataset.theme = t; } catch (e) { /* sem storage */ }
  const themeBtn = document.getElementById("tema");
  const isDark = () => root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const paint = () => { if (themeBtn) { themeBtn.textContent = isDark() ? "☀️" : "🌙"; themeBtn.setAttribute("aria-label", isDark() ? "Usar tema claro" : "Usar tema escuro"); } };
  paint();
  themeBtn?.addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("saudometro-site-tema", root.dataset.theme); } catch (e) { /* sem storage */ }
    paint();
  });
  const menu = document.getElementById("menu"), nav = document.getElementById("nav");
  menu?.addEventListener("click", () => { const o = nav.classList.toggle("open"); menu.setAttribute("aria-expanded", String(o)); });
  nav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const txt = b.dataset.copy, old = b.textContent;
    try { await navigator.clipboard.writeText(txt); b.textContent = "Copiado!"; } catch (e) { b.textContent = "Selecione e copie o endereço"; }
    setTimeout(() => { b.textContent = old; }, 2200);
  }));
  // abas da página de instalação (Android, iPhone, computador)
  const tabs = document.querySelectorAll(".tab");
  const show = (id) => {
    tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.id === id));
  };
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));
  if (tabs.length) show(/iPhone|iPad|iPod/.test(navigator.userAgent) ? "iphone" : /Android/.test(navigator.userAgent) ? "android" : "android");
  const dock = document.getElementById("dock");
  if (dock) {
    const onScroll = () => dock.classList.toggle("on", window.scrollY > 520);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
