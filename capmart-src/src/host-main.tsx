// Ponto de entrada usado dentro do Saudômetro (capmart.html) — diferente de main.tsx, que é
// só o executável independente de desenvolvimento com o simulador local. Aqui resolve a
// sessão/identidade real antes de montar o jogo, e nunca cai no simulador (se a sessão não
// resolver, mostra um erro em vez de abrir com saldo fictício).
import { createRoot } from 'react-dom/client';
import { CapMart } from './components/CapMart';
import { resolveLaunch, createSupabaseServices } from './services/supabase';
import './styles.css';
import './theme.css';
import './force-mobile.css';

const root = document.getElementById('root')!;

// capmart/index.html mora um nível abaixo da raiz do app — "../" volta pro Saudômetro
function closeToSaudometro() {
  window.location.href = '../index.html?tab=shop';
}

async function boot() {
  const resolved = await resolveLaunch();
  if ('error' in resolved) {
    root.innerHTML = `<div style="display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; text-align:center; font-family:system-ui, sans-serif; color:#52323c;">
      <div><p style="font-size:16px; margin-bottom:16px;">${resolved.error}</p>
      <button onclick="window.location.href='../index.html'" style="padding:10px 18px; border-radius:999px; border:none; background:#bd2857; color:#fff; font-weight:700;">Voltar pro Saudômetro</button></div>
    </div>`;
    return;
  }
  const { identity, context } = resolved;
  const services = createSupabaseServices(identity, context, undefined, closeToSaudometro);
  createRoot(root).render(<CapMart services={services} mascotUrl="./capivara.jpg" onClose={closeToSaudometro} />);
}

boot();
