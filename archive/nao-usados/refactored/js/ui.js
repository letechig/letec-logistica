// ============================================
// UI.JS - Manipulação de DOM
// ============================================

// ============================================
// NAVEGAÇÃO E PÁGINAS
// ============================================

export function navigateTo(pageName) {
  // Esconde todas as páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Mostra apenas a página selecionada
  const page = document.getElementById(`page-${pageName}`);
  if (page) {
    page.classList.add('active');
  }

  // Atualiza active na nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  document.querySelectorAll(`[data-nav="${pageName}"]`).forEach(item => {
    item.classList.add('active');
  });

  // Atualiza título da página
  const titles = {
    'dashboard': { title: 'Dashboard', sub: 'Visão geral operacional' },
    'agenda': { title: 'Agenda de Serviços', sub: 'Gerenciamento de cronograma' },
    'hoje': { title: 'Painel do Dia', sub: 'Execução em tempo real' },
    'roteiro': { title: 'Roteiro do Dia', sub: 'Distribuição por equipe' },
    'rotas': { title: 'Rotas & KM', sub: 'Eficiência de deslocamento' },
    'checklist': { title: 'Check List Diário', sub: 'Registro de frotas' },
    'frota': { title: 'Controle de Frota', sub: 'KPIs de veículos' },
    'equipes': { title: 'Análise por Equipes', sub: 'Produtividade' },
    'clientes': { title: 'Clientes', sub: 'Base de clientes 2026' },
    'historico': { title: 'Histórico Completo', sub: 'Todos os registros' },
  };

  const titleData = titles[pageName] || { title: 'Sem título', sub: '' };
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-sub');

  if (titleEl) titleEl.textContent = titleData.title;
  if (subEl) subEl.textContent = titleData.sub;
}

// ============================================
// MODAIS
// ============================================

export function openModal(title, content, showDelete = false) {
  const modal = document.getElementById('modal');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const delBtn = document.getElementById('modal-del');

  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.innerHTML = content;
  if (delBtn) {
    delBtn.style.display = showDelete ? 'inline-flex' : 'none';
  }
  if (modal) modal.classList.add('open');
}

export function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('open');
}

export function openRotateiroModal(content) {
  const modal = document.getElementById('rot-modal');
  const textArea = document.getElementById('rot-modal-txt');

  if (textArea) textArea.value = content;
  if (modal) modal.classList.add('open');
}

export function closeRotateiroModal() {
  const modal = document.getElementById('rot-modal');
  if (modal) modal.classList.remove('open');
}

// ============================================
// TOASTS / NOTIFICAÇÕES
// ============================================

export function showToast(message, type = 'ok', duration = 3000) {
  const toastWrap = document.getElementById('toasts');
  if (!toastWrap) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = {
    'ok': '✅',
    'err': '❌',
    'warn': '⚠️'
  }[type] || '💬';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastWrap.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}

// ============================================
// BADGES E CONTADORES
// ============================================

export function updateBadges(agendaCount = 0, hojeCount = 0, roteiroCount = 0, frotaCount = 0) {
  const badges = {
    'nb-agenda': agendaCount,
    'nb-hoje': hojeCount,
    'nb-roteiro': roteiroCount,
    'nb-frota': frotaCount,
  };

  Object.entries(badges).forEach(([id, count]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count > 0 ? count : '0';
      el.style.display = count > 0 ? 'inline-block' : 'none';
    }
  });
}

// ============================================
// INPUT HELPERS
// ============================================

export function getInputValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

export function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

export function clearInput(id) {
  const el = document.getElementById(id);
  if (el) el.value = '';
}

export function getSelectValue(id) {
  return getInputValue(id);
}

export function setSelectValue(id, value) {
  setInputValue(id, value);
}

// ============================================
// VISIBILIDADE E DISPLAY
// ============================================

export function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

export function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

export function isVisible(id) {
  const el = document.getElementById(id);
  return el && el.style.display !== 'none';
}

// ============================================
// HTML E RENDERIZAÇÃO
// ============================================

export function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function getHTML(id) {
  const el = document.getElementById(id);
  return el ? el.innerHTML : '';
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ============================================
// CÓPIA PARA CLIPBOARD
// ============================================

export function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copiado para a área de transferência!', 'ok');
  }).catch(err => {
    console.error('Erro ao copiar:', err);
    showToast('Erro ao copiar', 'err');
  });
}

// ============================================
// DATAS
// ============================================

export function formatDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('pt-BR', {
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
}

export function getDateDay(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    return days[date.getDay()];
  } catch (e) {
    return '—';
  }
}

export function getDateMonth(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return String(date.getMonth() + 1).padStart(2, '0');
  } catch (e) {
    return '';
  }
}

// ============================================
// EXPORTS SUPLEMENTARES
// ============================================

export function addEventListenerToElement(selector, event, handler) {
  const el = document.querySelector(selector);
  if (el) {
    el.addEventListener(event, handler);
  }
}

export function removeEventListenerFromElement(selector, event, handler) {
  const el = document.querySelector(selector);
  if (el) {
    el.removeEventListener(event, handler);
  }
}

export function onDocumentReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback);
  } else {
    callback();
  }
}
