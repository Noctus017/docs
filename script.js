// ===== BASES =====
const API_BASE = document.querySelector('meta[name="api-base"]')?.content;

// Detecta se está em github.io com path do repositório
function computeReturnBase(){
  const origin = window.location.origin;                     // https://usuario.github.io
  const parts = window.location.pathname.split('/').filter(Boolean);
  // Em GitHub Pages de projeto, a primeira parte é o nome do repo
  const repoPrefix = (origin.includes('github.io') && parts.length > 0) ? `/${parts[0]}` : '';
  return origin + repoPrefix;                                // ex.: https://usuario.github.io/seu-repo
}
const RETURN_BASE = computeReturnBase();

// ===== PIX CONFIG =====
const PIX_KEY = '9a6c4f0a-8bb3-40ca-b106-81fe1d90a3f6';
const MERCHANT_NAME = 'Projeto Lar Carioca';
const MERCHANT_CITY = 'RIO DE JANEIRO';
const PIX_DESCRIPTION = 'Doacao Lar Carioca';

// ===== UI / Estado =====
const buttons = document.querySelectorAll('.amount');
const custom = document.getElementById('customAmount');
const selSpan = document.getElementById('sel');
const btnCard = document.getElementById('btnCard');
let selected = 20;

function formatBRL(n){ return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parseBRL(input){ const s = String(input).trim().replace(/\./g, '').replace(',', '.'); const n = Number(s); return Number.isFinite(n) ? n : 0; }
function renderSelected(){ selSpan.textContent = formatBRL(selected); }
function setSelectedFromButton(b){
  const v = Number(b.dataset.amount || 0);
  if (v > 0) {
    selected = v; custom.value = '';
    buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderSelected(); clearPixOutputs();
  }
}
buttons.forEach(b => b.addEventListener('click', () => setSelectedFromButton(b)));
custom.addEventListener('input', () => {
  const v = parseBRL(custom.value);
  if (v > 0) { selected = v; buttons.forEach(x => x.setAttribute('aria-pressed', 'false')); renderSelected(); clearPixOutputs(); }
});
document.getElementById('year').textContent = new Date().getFullYear();
buttons.forEach(b => { if (Number(b.dataset.amount) === selected) b.setAttribute('aria-pressed', 'true'); });
renderSelected();

// ===== Abas (Cartão / PIX) =====
const tabs = document.querySelectorAll('.tab');
const panelCard = document.getElementById('panel-card');
const panelPix  = document.getElementById('panel-pix');
tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const tab = t.dataset.tab;
  panelCard.classList.toggle('hidden', tab !== 'card');
  panelPix.classList.toggle('hidden',  tab !== 'pix');
}));

// ===== Cartão (Stripe Checkout) — backend externo, retorna para Pages =====
btnCard?.addEventListener('click', async () => {
  try {
    const amount = Math.max(1, Number(selected || 0));
    const resp = await fetch(`${API_BASE}/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method: 'card', returnBase: RETURN_BASE })
    });
    const data = await resp.json();
    if (!resp.ok) { alert(data?.error || 'Falha ao iniciar pagamento.'); return; }
    if (data?.url) window.location.href = data.url;
    else alert('Resposta inesperada do servidor.');
  } catch (err) {
    console.error(err); alert('Erro de rede ao iniciar pagamento.');
  }
});

// ===== PIX (offline — BR Code + QR gerado no backend) =====
const pixKeyLabel = document.getElementById('pixKeyLabel');
pixKeyLabel.textContent = PIX_KEY;

const btnPix  = document.getElementById('btnPix');
const qrImg   = document.getElementById('qrImg');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const pixCopy = document.getElementById('pixCopy');
const btnCopy = document.getElementById('btnCopy');

function clearPixOutputs(){
  pixCopy.value = '';
  if (qrImg){ qrImg.src = ''; qrImg.style.display = 'none'; }
  if (qrPlaceholder) qrPlaceholder.style.display = 'inline';
}

function normalizeText(s){
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9\s\-\.\,]/g, '').slice(0, 25);
}
function tlv(id, value){ const val = String(value ?? ''); const len = String(val.length).padStart(2, '0'); return id + len + val; }
function crc16(payload){
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++){
    crc ^= (payload.charCodeAt(i) & 0xFF) << 8;
    for (let j = 0; j < 8; j++){
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function buildPixBRCode({ key, amount, merchantName, merchantCity, description, txid }){
  const name = normalizeText(merchantName || 'LAR CARIOCA');
  const city = normalizeText(merchantCity || 'RIO DE JANEIRO');
  const amt  = Number(amount || 0).toFixed(2);
  const gui  = tlv('00', 'br.gov.bcb.pix');
  const k    = tlv('01', key);
  const desc = description ? tlv('02', String(description).slice(0, 50)) : '';
  const mai  = tlv('26', gui + k + desc);
  const addl = tlv('62', tlv('05', (txid || ('LARCAR' + Math.random().toString(36).slice(2, 10))).toUpperCase().slice(0,25)));
  let payload =
    tlv('00', '01') + tlv('01', '12') + mai +
    tlv('52', '0000') + tlv('53', '986') + tlv('54', amt) +
    tlv('58', 'BR') + tlv('59', name) + tlv('60', city) + addl;
  payload += '6304';
  return payload + crc16(payload);
}

btnPix?.addEventListener('click', async () => {
  try {
    const amount = Math.max(1, Number(selected || 0));
    const brcode = buildPixBRCode({
      key: PIX_KEY, amount,
      merchantName: MERCHANT_NAME, merchantCity: MERCHANT_CITY,
      description: PIX_DESCRIPTION
    });

    pixCopy.value = brcode;

    const resp = await fetch(`${API_BASE}/pix/qrcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brcode, size: 220 })
    });
    const data = await resp.json();
    if (!resp.ok) { alert(data?.error || 'Falha ao gerar QR Code.'); return; }
    if (data?.dataUrl) {
      qrImg.src = data.dataUrl; qrImg.style.display = 'block';
      if (qrPlaceholder) qrPlaceholder.style.display = 'none';
    } else { alert('Resposta inesperada ao gerar QR.'); }
  } catch (e) {
    console.error(e); alert('Erro ao gerar QR Code PIX.');
  }
});

btnCopy?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pixCopy.value);
    btnCopy.textContent = 'Copiado!'; setTimeout(() => (btnCopy.textContent = 'Copiar código PIX'), 1200);
  } catch {
    pixCopy.select(); document.execCommand('copy');
    btnCopy.textContent = 'Copiado!'; setTimeout(() => (btnCopy.textContent = 'Copiar código PIX'), 1200);
  }
});
