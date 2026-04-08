// ============================================
// APP.JS - Inicialização e orquestração
// ============================================

import { loadCatalogs } from './supabase.js';
import * as Services from './services.js';
import * as UI from './ui.js';

// ============================================
// INICIALIZAÇÃO
// ============================================

async function init() {
  console.log('🚀 Iniciando Letec v7.8...');

  // 1. Carregar dados do localStorage como fallback
  Services.loadState();
  Services.loadCheckListRecords();

  // 2. Carregar catálogos do Supabase
  try {
    await loadCatalogs();
    console.log('✅ Catálogos carregados');
  } catch (e) {
    console.warn('⚠️ Supabase indisponível, usando dados locais');
  }

  // 3. Tentar carregar serviços do Supabase
  try {
    const loadedFromSupabase = await Services.loadServicesFromSupabase();
    if (!loadedFromSupabase) {
      console.log('📱 Usando dados locais');
    }
  } catch (e) {
    console.warn('⚠️ Erro ao carregar serviços do Supabase, usando localStorage:', e);
  }

  // 4. Configurar event listeners
  setupEventListeners();

  // 5. Navegar para dashboard
  UI.navigateTo('dashboard');
  renderDashboard();

  console.log('✅ App iniciado com sucesso!');
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Navegação sidebar
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = btn.getAttribute('data-nav');
      UI.navigateTo(page);
      Services.setCurrentPage(page);
      renderPage(page);
    });
  });

  // Filtro de mês global
  const globalMes = document.getElementById('global-mes');
  if (globalMes) {
    globalMes.addEventListener('change', (e) => {
      Services.setCurrentMonthFilter(e.target.value);
      renderPage(Services.getCurrentPage());
    });
  }

  // Filtro de mês no dashboard
  const dashMes = document.getElementById('dash-mes-filter');
  if (dashMes) {
    dashMes.addEventListener('change', (e) => {
      Services.setCurrentMonthFilter(e.target.value);
      renderDashboard();
    });
  }

  // Botões principais
  document.getElementById('btn-changelog')?.addEventListener('click', () => {
    UI.openModal('Changelog v7.8', '<p>Sistema de Logística v7.8</p><ul><li>Refatoração completa do frontend</li><li>Módulos separados (supabse, services, ui)</li><li>ES Modules</li><li>Melhor organização</li></ul>');
  });

  document.getElementById('btn-new-checklist')?.addEventListener('click', () => {
    UI.navigateTo('checklist');
    renderCheckList();
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);

  // Modal
  document.getElementById('btn-modal-close')?.addEventListener('click', UI.closeModal);
  document.getElementById('modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal') UI.closeModal();
  });

  // Modal Roteiro
  document.getElementById('btn-rot-close-modal')?.addEventListener('click', UI.closeRotateiroModal);
  document.getElementById('btn-rot-copy-modal')?.addEventListener('click', () => {
    const text = document.getElementById('rot-modal-txt')?.value || '';
    UI.copyToClipboard(text);
  });
  document.getElementById('rot-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'rot-modal') UI.closeRotateiroModal();
  });

  // Check List
  document.getElementById('btn-cl-clear')?.addEventListener('click', clearCheckList);
  document.getElementById('btn-cl-save')?.addEventListener('click', saveCheckList);
  document.getElementById('btn-cl-check-all')?.addEventListener('click', checkAllEquipments);
  document.getElementById('btn-cl-uncheck-all')?.addEventListener('click', uncheckAllEquipments);

  document.getElementById('cl-kms')?.addEventListener('input', calcKM);
  document.getElementById('cl-kmc')?.addEventListener('input', calcKM);

  document.getElementById('cl-av-cb')?.addEventListener('change', toggleAvariaField);

  // Veiculo selecionador
  document.querySelectorAll('.veh-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.veh-btn').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      document.getElementById('cl-vei').value = btn.getAttribute('data-v');
    });
  });

  // Combustível selecionador
  document.querySelectorAll('.fuel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.fuel-btn').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      document.getElementById('cl-fuel').value = btn.getAttribute('data-f');
    });
  });

  // Hoje
  document.getElementById('btn-hoje-prev')?.addEventListener('click', () => moveHojeDate(-1));
  document.getElementById('btn-hoje-today')?.addEventListener('click', goToTodaySimple);
  document.getElementById('btn-hoje-next')?.addEventListener('click', () => moveHojeDate(1));
  document.getElementById('btn-hoje-new')?.addEventListener('click', () => UI.navigateTo('checklist'));
  document.getElementById('hoje-date')?.addEventListener('change', renderHoje);

  // Agenda
  document.getElementById('ag-search')?.addEventListener('input', renderAgenda);
  document.getElementById('ag-tipo')?.addEventListener('change', renderAgenda);
  document.getElementById('ag-status')?.addEventListener('change', renderAgenda);
  document.getElementById('ag-mes')?.addEventListener('change', renderAgenda);

  document.getElementById('ag-view-list')?.addEventListener('click', () => {
    setAgendaView('list');
  });
  document.getElementById('ag-view-board')?.addEventListener('click', () => {
    setAgendaView('kanban');
  });
  document.getElementById('ag-view-data')?.addEventListener('click', () => {
    setAgendaView('data');
  });

  // Rotas
  document.getElementById('rota-date')?.addEventListener('change', renderRotas);

  // Histórico
  document.getElementById('hist-mot')?.addEventListener('change', renderHist);
  document.getElementById('hist-vei')?.addEventListener('change', renderHist);
  document.getElementById('btn-hist-export')?.addEventListener('click', exportCSV);

  // Frota
  document.getElementById('btn-imp-save')?.addEventListener('click', saveImport);
  document.getElementById('btn-imp-clear')?.addEventListener('click', clearImport);

  // Roteiro
  document.getElementById('rot-data')?.addEventListener('change', renderRoteiro);
  document.getElementById('btn-rot-gerar')?.addEventListener('click', renderRoteiro);
}

// ============================================
// RENDERIZAÇÃO DE PÁGINAS
// ============================================

function renderPage(pageName) {
  switch (pageName) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'agenda':
      renderAgenda();
      break;
    case 'hoje':
      renderHoje();
      break;
    case 'roteiro':
      renderRoteiro();
      break;
    case 'rotas':
      renderRotas();
      break;
    case 'checklist':
      renderCheckList();
      break;
    case 'frota':
      renderFrota();
      break;
    case 'equipes':
      renderEquipes();
      break;
    case 'clientes':
      renderClientes();
      break;
    case 'historico':
      renderHist();
      break;
  }
}

function renderDashboard() {
  const svcs = Services.getFilteredServices();
  const summary = Services.getMonthlySummary();
  const mes = Services.getCurrentMonthFilter();

  const mesSummary = summary[mes] || { total: 0, executado: 0, agendado: 0, reagendado: 0, cancelado: 0 };

  const today = new Date().toISOString().split('T')[0];

  // ── Cálculos base ──────────────────────────────────────────
  const byStatus = {};
  svcs.forEach(s => {
    const k = (s.status || s.st || 'agendado').toLowerCase();
    byStatus[k] = (byStatus[k] || 0) + 1;
  });
  const exec = byStatus['executado'] || 0;
  const reagend = byStatus['reagendado'] || 0;
  const cancel = byStatus['cancelado'] || 0;
  const agend = byStatus['agendado'] || 0;
  const pend = agend;
  const txExec = svcs.length ? Math.round(exec / svcs.length * 100) : 0;

  // KPIs de alerta
  const semEquipe = svcs.filter(s => !Services.getServiceTeam(s));
  const vencidos = svcs.filter(s => s.dt < today && (s.status || s.st) === 'agendado');

  // Capacidade — baseada em TEMPO REAL
  const numTecnicos = Services.getUniqueTeams().length;
  const diasComSvc = new Set(svcs.map(s => s.dt)).size;
  const mediaPerDia = diasComSvc ? +(svcs.length / diasComSvc).toFixed(1) : 0;
  const byDia = {};
  svcs.forEach(s => { byDia[s.dt] = (byDia[s.dt] || 0) + 1; });
  const maxDia = Math.max(...Object.values(byDia), 0);

  // ── Capacidade por TEMPO (não por contagem) ──
  const diasUnicos = [...new Set(svcs.map(s => s.dt))];
  let tempoConsumidoTotal = 0, tempoDisponivelTotal = 0;
  diasUnicos.forEach(dt => {
    const dSvcs = svcs.filter(s => s.dt === dt);
    const cap = Services.calculateCapacity(dSvcs);
    tempoConsumidoTotal += cap.usado;
    tempoDisponivelTotal += cap.total;
  });
  const pctOcup = tempoDisponivelTotal > 0 ? Math.round(tempoConsumidoTotal / tempoDisponivelTotal * 100) : 0;
  const tempoLivreTot = Math.max(0, tempoDisponivelTotal - tempoConsumidoTotal);
  const slotsLivres = Math.floor(tempoLivreTot / 90); // assume 90min por serviço
  const sobrecargaDia = maxDia >= 8;
  const ociosDia = pctOcup < 40 && svcs.length > 10;

  // ── Período ────────────────────────────────────────────────
  const mesLabel = mes === 'all' ? 'Ano inteiro 2026' : `${mes} 2026`;

  // ── ZONA 0: Painel de Decisão Rápida ──────────────────────
  const decidir = () => {
    if (!svcs.length) return { cor: 'var(--text3)', bg: 'var(--surface)', icon: '📭', msg: 'Sem dados para o período selecionado.', acao: '' };
    if (vencidos.length > 5 || semEquipe.length > 10) return { cor: 'var(--red)', bg: 'var(--red-bg)', icon: '🚨', msg: `Atenção imediata necessária: ${vencidos.length} serviço(s) vencido(s) sem execução, ${semEquipe.length} sem equipe.`, acao: 'Revisar e alocar equipes.' };
    if (sobrecargaDia) return { cor: 'var(--orange)', bg: 'var(--orange-bg)', icon: '🔥', msg: `Pico de ${maxDia} serviços em um dia detectado. Equipe pode estar sobrecarregada.`, acao: 'Considerar redistribuição.' };
    if (pctOcup < 40 && svcs.length > 10) return { cor: 'var(--blue)', bg: 'var(--blue-bg)', icon: '📈', msg: `Capacidade ociosa: ${pctOcup}% do tempo alocado. Estimativa: ainda cabem ~${slotsLivres} serviços no período.`, acao: 'Pode vender mais serviços.' };
    if (pctOcup > 85) return { cor: 'var(--orange)', bg: 'var(--orange-bg)', icon: '⚠️', msg: `Equipe próxima do limite: ${pctOcup}% do tempo disponível já alocado.`, acao: 'Avaliar contratação.' };
    return { cor: 'var(--green)', bg: 'var(--green-bg)', icon: '✅', msg: `Operação equilibrada: ${pctOcup}% do tempo disponível utilizado. ${slotsLivres > 0 ? `Ainda cabem ~${slotsLivres} serviços.` : ''}`, acao: '' };
  };
  const dec = decidir();
  const decEl = document.getElementById('dash-decisao-rapida');
  if (decEl) decEl.innerHTML = `
    <div style="padding:14px 18px;background:${dec.bg};border:1.5px solid ${dec.cor}40;border-radius:var(--r);display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span style="font-size:28px;flex-shrink:0">${dec.icon}</span>
      <div style="flex:1;min-width:200px">
        <div style="font-family:var(--display);font-weight:800;font-size:13px;color:${dec.cor};margin-bottom:3px">${dec.msg}</div>
        ${dec.acao ? `<div style="font-size:11px;color:var(--text3)">${dec.acao}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
        <div style="text-align:center;padding:6px 14px;background:${dec.cor}18;border-radius:var(--r2);border:1px solid ${dec.cor}30">
          <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:${dec.cor}">${pctOcup}%</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Ocupação</div>
        </div>
        <div style="text-align:center;padding:6px 14px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border)">
          <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--text)">${mediaPerDia}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Serv/dia</div>
        </div>
        <div style="text-align:center;padding:6px 14px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border)">
          <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:var(--blue2)">${numTecnicos}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">Técnicos</div>
        </div>
      </div>
    </div>`;

  // ── ZONA 1: KPIs ───────────────────────────────────────────
  const kpiTxColor = txExec >= 70 ? 'var(--green)' : txExec >= 50 ? 'var(--orange)' : 'var(--red)';
  document.getElementById('dash-kpis').innerHTML = `
    <div class="card card-accent"><div class="card-label">Total Serviços</div><div class="card-value cv-blue">${svcs.length}</div><div class="card-trend">${mesLabel}</div></div>
    <div class="card card-green"><div class="card-label">Executados</div><div class="card-value cv-green">${exec}</div><div class="card-trend up">${txExec}% concluídos</div></div>
    <div class="card"><div class="card-label">Pendentes</div><div class="card-value">${pend}</div><div class="card-trend">aguardando execução</div></div>
    <div class="card card-orange"><div class="card-label">Reagendados</div><div class="card-value cv-orange">${reagend}</div><div class="card-trend">necessitam nova data</div></div>
    <div class="card" style="border-top:2px solid var(--red)"><div class="card-label">⚠ Sem Equipe</div><div class="card-value" style="color:${semEquipe.length ? 'var(--red)' : 'var(--green)'}">${semEquipe.length}</div><div class="card-trend">${semEquipe.length ? 'definir responsável' : '✓ todos alocados'}</div></div>
    <div class="card" style="border-top:2px solid ${vencidos.length ? 'var(--red)' : 'var(--green)'}"><div class="card-label">⏰ Vencidos</div><div class="card-value" style="color:${vencidos.length ? 'var(--red)' : 'var(--green)'}">${vencidos.length}</div><div class="card-trend">${vencidos.length ? 'datas passadas, ainda agendado' : '✓ em dia'}</div></div>
    <div class="card card-red"><div class="card-label">Cancelados</div><div class="card-value cv-red">${cancel}</div><div class="card-trend">no período</div></div>
    <div class="card" style="border-top:2px solid ${kpiTxColor}"><div class="card-label">Taxa Execução</div><div class="card-value" style="color:${kpiTxColor}">${txExec}%</div><div class="card-trend">${txExec >= 70 ? '✓ meta atingida' : txExec >= 50 ? '⚠ abaixo da meta' : '✕ crítico'}</div></div>
  `;

  // ── ZONA 2A: Problemas Críticos ────────────────────────────
  const criticos = [];
  if (vencidos.length) criticos.push({ icon: '⏰', cor: 'var(--red)', txt: `${vencidos.length} serviço(s) com data passada ainda "agendado"` });
  if (semEquipe.length) criticos.push({ icon: '👷', cor: 'var(--red)', txt: `${semEquipe.length} serviço(s) sem equipe definida` });

  const alertCountEl = document.getElementById('dash-alert-count');
  if (alertCountEl) alertCountEl.textContent = criticos.length + (criticos.length !== 1 ? ' problemas' : ' problema');

  document.getElementById('dash-alerts').innerHTML = criticos.length
    ? criticos.map(a => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${a.cor}0d;border-radius:var(--r2);border-left:3px solid ${a.cor};margin-bottom:7px">
          <span style="font-size:16px;flex-shrink:0">${a.icon}</span>
          <span style="font-size:12px;color:var(--text);line-height:1.4;font-weight:500">${a.txt}</span>
        </div>`).join('')
    : `<div style="text-align:center;padding:24px;color:var(--green)">
        <div style="font-size:32px;margin-bottom:8px">✅</div>
        <div style="font-size:12px;font-weight:600">Nenhum problema crítico</div>
      </div>`;

  // ── ZONA 2B: Avisos Operacionais ───────────────────────────
  const avisos = [];
  if (reagend) avisos.push({ icon: '🔄', cor: 'var(--orange)', txt: `${reagend} serviço(s) reagendado(s) sem nova data confirmada` });
  if (sobrecargaDia) avisos.push({ icon: '🔥', cor: 'var(--orange)', txt: `Pico de ${maxDia} serviços em um único dia` });
  if (ociosDia) avisos.push({ icon: '📉', cor: 'var(--blue)', txt: `Ritmo abaixo do esperado: média ${mediaPerDia} serv/dia` });

  const avisoCountEl = document.getElementById('dash-aviso-count');
  if (avisoCountEl) avisoCountEl.textContent = avisos.length + (avisos.length !== 1 ? ' avisos' : ' aviso');

  document.getElementById('dash-avisos').innerHTML = avisos.length
    ? avisos.map(a => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${a.cor}0d;border-radius:var(--r2);border-left:3px solid ${a.cor};margin-bottom:7px">
          <span style="font-size:16px;flex-shrink:0">${a.icon}</span>
          <span style="font-size:12px;color:var(--text);line-height:1.4">${a.txt}</span>
        </div>`).join('')
    : `<div style="text-align:center;padding:24px;color:var(--green)">
        <div style="font-size:32px;margin-bottom:8px">🟢</div>
        <div style="font-size:12px;font-weight:600">Nenhum aviso operacional</div>
      </div>`;

  // ── ZONA 2C: Capacidade ────────────────────────────────────
  const capEl = document.getElementById('dash-capacidade');
  if (capEl) {
    const corCap = pctOcup >= 85 ? 'var(--red)' : pctOcup >= 60 ? 'var(--orange)' : 'var(--green)';
    const msgCap = pctOcup >= 85
      ? 'Próxima do limite — avaliar contratação'
      : slotsLivres > 0
      ? `Pode absorver mais ~${slotsLivres} serviços`
      : 'Capacidade bem distribuída';
    capEl.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:11px;color:var(--text3)">Ocupação estimada</span>
          <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:${corCap}">${pctOcup}%</span>
        </div>
        <div style="height:10px;background:var(--border);border-radius:99px;overflow:hidden;margin-bottom:6px">
          <div style="height:100%;width:${Math.min(pctOcup, 100)}%;background:${corCap};border-radius:99px;transition:width .4s"></div>
        </div>
        <div style="font-size:11px;color:${corCap};font-weight:600">${msgCap}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="padding:8px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border);text-align:center">
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--blue2)">${numTecnicos}</div>
          <div style="font-size:9px;color:var(--text3)">técnicos ativos</div>
        </div>
        <div style="padding:8px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border);text-align:center">
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--blue2)">${maxDia}</div>
          <div style="font-size:9px;color:${maxDia >= 8 ? 'var(--red)' : 'var(--text3)'}">pico (serv/dia)</div>
        </div>
        <div style="padding:8px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border);text-align:center">
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--blue2)">${mediaPerDia}</div>
          <div style="font-size:9px;color:var(--text3)">média serv/dia</div>
        </div>
        <div style="padding:8px;background:var(--bg2);border-radius:var(--r2);border:1px solid var(--border);text-align:center">
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:${slotsLivres > 0 ? 'var(--green)' : 'var(--orange)'}">${slotsLivres}</div>
          <div style="font-size:9px;color:var(--text3)">slots disponíveis</div>
        </div>
      </div>
      <div style="font-size:11px;background:var(--surface);border-radius:var(--r2);padding:7px 10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="color:var(--text3)">⏱ Tempo alocado</span>
          <span style="font-family:var(--mono);font-weight:600">${Math.floor(tempoConsumidoTotal / 60)}h${tempoConsumidoTotal % 60 ? String(tempoConsumidoTotal % 60).padStart(2, '0') + 'min' : ''}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:var(--text3)">✅ Tempo livre</span>
          <span style="font-family:var(--mono);font-weight:600;color:${tempoLivreTot > 0 ? 'var(--green)' : 'var(--orange)'}">${Math.floor(tempoLivreTot / 60)}h${tempoLivreTot % 60 ? String(tempoLivreTot % 60).padStart(2, '0') + 'min' : ''}</span>
        </div>
      </div>
      <div style="font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:8px">Top técnicos</div>
      ${Services.getTopTechnicians().slice(0, 4).map(d => {
        const cor = d.tx >= 70 ? 'var(--green)' : d.tx >= 50 ? 'var(--orange)' : 'var(--red)';
        return `<div style="margin-bottom:7px">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px">
            <span style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px" title="${d.nome}">${d.nome.split(' ')[0]}</span>
            <span style="font-family:var(--mono);font-size:10px;color:${cor}">${d.total}sv · ${d.media}/dia</span>
          </div>
          <div class="prog"><div class="prog-fill" style="width:${Math.min(d.total / Math.max(...Services.getTopTechnicians().map(x => x.total), 1) * 100, 100)}%;background:${cor}"></div></div>
        </div>`;
      }).join('')}
      <div style="font-size:9px;color:var(--text4);margin-top:8px">Base: tempo real por tipo · jornada 08:00–17:48</div>
    `;
  }

  // ── ZONA 3: Tipos, Semanas, Horários ───────────────────────
  const paleta = ['#2563eb', '#16a34a', '#0891b2', '#ea580c', '#7c3aed', '#b45309', '#dc2626', '#94a3b8'];
  const byTipo = {};
  svcs.forEach(s => {
    const t = (s.tipoServico || s.sc || 'Outro').toUpperCase().split(/[\s/,]/)[0] || 'OUTRO';
    byTipo[t] = (byTipo[t] || 0) + 1;
  });
  const tiposOrd = Object.entries(byTipo).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxTipo = Math.max(...tiposOrd.map(t => t[1]), 1);
  document.getElementById('dash-equipe-chart').innerHTML = tiposOrd.map(([tipo, cnt], i) => {
    const cor = paleta[i % paleta.length];
    const pct = Math.round(cnt / svcs.length * 100);
    return `<div class="mb3"><div class="flex ic sb mb1"><span style="font-weight:600;font-size:12px;color:${cor}">${tipo}</span><span class="font-mono" style="font-size:11px;color:${cor}">${cnt} · ${pct}%</span></div><div class="prog"><div class="prog-fill" style="width:${Math.round(cnt / maxTipo * 100)}%;background:${cor}"></div></div></div>`;
  }).join('') || '<div class="text-muted">Sem dados</div>';

  const byWeek = {};
  svcs.forEach(s => {
    const d = new Date(s.dt);
    const w = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + (new Date(d.getFullYear(), d.getMonth(), 1).getDay())) / 7)).padStart(2, '0')}`;
    byWeek[w] = (byWeek[w] || 0) + 1;
  });
  const weeks = Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const maxW = Math.max(...weeks.map(w => w[1]), 1);
  document.getElementById('dash-bar').innerHTML = weeks.map(([w, n]) => {
    const h = Math.max(4, Math.round(n / maxW * 80));
    const lbl = w.split('-W')[1] ? `S${w.split('-W')[1]}` : '';
    return `<div class="bar-col"><div class="bar-val">${n}</div><div class="bar-fill" style="height:${h}px;background:var(--blue)"></div><div class="bar-lbl">${lbl}</div></div>`;
  }).join('');

  // Gráfico por hora
  const byHora = {};
  svcs.forEach(s => {
    const hm = (s.horario || s.hr || '').match(/^(\d{1,2})/);
    if (hm) {
      const hv = parseInt(hm[1]);
      if (hv >= 0 && hv <= 23) byHora[hv] = (byHora[hv] || 0) + 1;
    }
  });
  const horasOrd = Object.entries(byHora).sort((a, b) => +a[0] - +b[0]);
  const maxH2 = Math.max(...Object.values(byHora), 1);
  const horaClr = h => h < 7 ? '#7c3aed' : h < 12 ? '#2563eb' : h < 14 ? '#16a34a' : h < 18 ? '#0891b2' : h < 20 ? '#ea580c' : '#dc2626';
  const horaEl = document.getElementById('dash-hora-chart');
  if (horaEl) {
    horaEl.innerHTML = horasOrd.length
      ? '<div style="display:flex;flex-direction:column;gap:5px">' +
        horasOrd.map(([h, n]) => {
          const cor = horaClr(+h);
          const pct = Math.round(n / maxH2 * 100);
          const pctT = svcs.length ? Math.round(n / svcs.length * 100) : 0;
          return `<div style="display:flex;align-items:center;gap:6px">
            <span style="font-family:var(--mono);font-size:10px;color:${cor};min-width:28px">${String(h).padStart(2, '0')}h</span>
            <div style="flex:1;height:10px;background:var(--border);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${cor};border-radius:99px"></div>
            </div>
            <span style="font-family:var(--mono);font-size:10px;color:${cor};min-width:52px;text-align:right">${n} (${pctT}%)</span>
          </div>`;
        }).join('') + '</div>'
      : '<div class="text-muted">Sem dados de horário</div>';
  }

  // ── ZONA 4: Status + Top Clientes + Frota ─────────────────
  document.getElementById('dash-status').innerHTML = Object.entries(Services.getStatusMeta()).map(([st, m]) => {
    const cnt = byStatus[st] || 0;
    const pct = svcs.length ? Math.round(cnt / svcs.length * 100) : 0;
    return `<div class="mb3"><div class="flex ic sb mb1"><span class="chip ${m.chip}">${m.label}</span><span class="font-mono" style="font-size:12px;color:${m.color}">${cnt}</span></div><div class="prog"><div class="prog-fill" style="width:${pct}%;background:${m.color}"></div></div></div>`;
  }).join('');

  const cliCnt = {};
  svcs.forEach(s => {
    const k = s.cliente || s.cl || '';
    if (k) cliCnt[k] = (cliCnt[k] || 0) + 1;
  });
  const top10 = Object.entries(cliCnt).sort((a, b) => b[1] - a[1]).slice(0, 10);
  document.getElementById('dash-top-clients').innerHTML = top10.map(([cl, cnt], i) =>
    `<div class="flex ic sb" style="padding:5px 0;border-bottom:1px solid var(--border);font-size:12px"><span style="color:var(--text2)">${i + 1}. ${cl.slice(0, 26)}</span><span class="chip chip-gray">${cnt}</span></div>`
  ).join('');

  const km_by_veic = {};
  Services.getCheckListRecords().forEach(r => {
    if (!r.vei) return;
    if (!km_by_veic[r.vei]) km_by_veic[r.vei] = { km: 0, d: 0 };
    km_by_veic[r.vei].km += (r.kmD || 0);
    km_by_veic[r.vei].d++;
  });
  const maxKm = Math.max(...Object.values(km_by_veic).map(x => x.km), 1);
  document.getElementById('dash-frota-km').innerHTML = Object.keys(km_by_veic).length
    ? Object.entries(km_by_veic).sort((a, b) => b[1].km - a[1].km).map(([v, d]) => `<div class="mb2"><div class="flex ic sb mb1"><span style="font-size:12px;font-weight:600">${v}</span><span class="font-mono text-blue" style="font-size:11px">${d.km.toLocaleString('pt-BR')} km</span></div><div class="prog"><div class="prog-fill" style="width:${Math.round(d.km / maxKm * 100)}%;background:var(--blue)"></div></div></div>`).join('')
    : '<div class="text-muted" style="font-size:11px">Sem registros de KM.</div>';

  const fd = {};
  Services.getCheckListRecords().forEach(r => {
    if (r.fuel) fd[r.fuel] = (fd[r.fuel] || 0) + 1;
  });
  const ftotal = Services.getCheckListRecords().length || 1;
  const fcolors = { CHEIO: 'var(--green)', '3/4': 'var(--green)', METADE: 'var(--yellow)', '1/4': 'var(--orange)', RESERVA: 'var(--red)' };
  document.getElementById('dash-fuel').innerHTML = Object.keys(fd).length
    ? ['CHEIO', '3/4', 'METADE', '1/4', 'RESERVA'].filter(f => fd[f]).map(f => {
      const p = Math.round(fd[f] / ftotal * 100);
      return `<div class="mb2"><div class="flex ic sb mb1"><span style="font-size:11px">${f}</span><span class="font-mono" style="font-size:11px;color:${fcolors[f]}">${fd[f]}x</span></div><div class="prog"><div class="prog-fill" style="width:${p}%;background:${fcolors[f]}"></div></div></div>`;
    }).join('')
    : '<div class="text-muted" style="font-size:11px">Sem dados de combustível.</div>';

  // ── ZONA 5: Eficiência de Rotas ─────────────────
  let totalKm = 0;
  let totalServicesWithRoute = 0;
  diasUnicos.forEach(dt => {
    const dSvcs = svcs.filter(s => s.dt === dt);
    if (dSvcs.length > 1) {
      const sorted = [...dSvcs].sort((a, b) => (a.horario || '00:00').localeCompare(b.horario || '00:00'));
      for (let i = 1; i < sorted.length; i++) {
        totalKm += Services.estimateDistance(sorted[i - 1].endereco || '', sorted[i].endereco || '');
        totalServicesWithRoute++;
      }
    }
  });
  const kmPerService = totalServicesWithRoute > 0 ? (totalKm / totalServicesWithRoute).toFixed(1) : 0;
  const fuelCost = totalKm * 1.5; // assume R$1.50/km

  document.getElementById('dash-eficiencia').innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Total KM percorridos: ${totalKm.toFixed(1)} km</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">KM por serviço: ${kmPerService} km</div>
    <div style="font-size:11px;color:var(--text3)">Dias com rotas: ${diasUnicos.filter(dt => svcs.filter(s => s.dt === dt).length > 1).length}</div>
  `;

  document.getElementById('dash-km-stats').innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Custo combustível estimado: R$ ${fuelCost.toFixed(2)}</div>
    <div style="font-size:11px;color:var(--text3)">Eficiência: ${kmPerService < 5 ? 'Ótima' : kmPerService < 10 ? 'Boa' : 'Melhorar'}</div>
  `;

  UI.updateBadges(
    Services.getServicesByStatus('agendado').length,
    Services.getServicesByStatus('executado').length,
    0,
    0
  );
}

function renderAgenda() {
  const today = new Date().toISOString().split('T')[0];
  const search = (document.getElementById('ag-search')?.value || '').toLowerCase();
  const tipoFilt = (document.getElementById('ag-tipo')?.value || '').toUpperCase();
  const stFilt = document.getElementById('ag-status')?.value || '';
  const mesFilt = document.getElementById('ag-mes')?.value || '';

  let svcs = Services.getFilteredServices();

  // Aplicar filtros
  if (search) {
    svcs = svcs.filter(s =>
      (s.cliente || s.cl || '').toLowerCase().includes(search) ||
      (s.endereco || '').toLowerCase().includes(search) ||
      Services.getServiceTeam(s).toLowerCase().includes(search)
    );
  }
  if (tipoFilt) {
    svcs = svcs.filter(s => {
      const tipos = Services.extractServiceTypes(s);
      if (tipos.includes(tipoFilt)) return true;
      const t = (s.tipoServico || s.sc || '').toUpperCase().split(/[\s/,]/)[0] || '';
      return t === tipoFilt;
    });
  }
  if (stFilt) {
    svcs = svcs.filter(s => (s.status || s.st) === stFilt);
  }
  if (mesFilt) {
    svcs = svcs.filter(s => Services.mesParaFiltro(s, mesFilt));
  }

  document.getElementById('ag-count').textContent = `${svcs.length} serviço(s)`;

  const subtitle = document.getElementById('ag-subtitle');
  if (subtitle) {
    const periodo = mesFilt ? Services.mesLabel(mesFilt) : Services.mesLabel(Services.getCurrentMonthFilter());
    subtitle.textContent = `${svcs.length} de ${Services.getServices().length} serviços · ${periodo}`;
  }

  // Determinar view atual
  const currentView = document.querySelector('#ag-view-list[style*="background"], #ag-view-board[style*="background"], #ag-view-data[style*="background"]')?.id?.replace('ag-view-', '') || 'data';

  if (currentView === 'kanban') {
    renderAgendaKanban(svcs);
  } else if (currentView === 'data') {
    renderAgendaData(svcs, today);
  } else {
    renderAgendaList(svcs, today);
  }
}

function renderAgendaList(svcs, today) {
  const tbody = document.getElementById('agenda-tbody');
  if (!tbody) return;

  tbody.innerHTML = svcs.map((s, i) => {
    const stKey = s.status || s.st || 'agendado';
    const st = Services.getStatusMeta()[stKey] || { label: stKey, chip: 'chip-gray' };
    const end = Services.sanitize(s.endereco || '');
    const endTrunc = end.length > 32 ? end.slice(0, 32) + '...' : (end || '—');
    const equipeLabel = Services.getServiceTeam(s);
    const semEq = !equipeLabel.trim();
    const vencido = stKey === 'agendado' && s.dt < today;
    const rowBg = vencido ? 'background:rgba(220,38,38,.04)' : semEq ? 'background:rgba(234,88,12,.04)' : '';
    const equipeHtml = semEq ? '<span style="color:var(--orange);font-size:10px;font-weight:600">⚠ sem equipe</span>' : Services.sanitize(equipeLabel).slice(0, 24);

    return `<tr onclick="openEditSvc(${Services.jsArg(s.id)})" style="cursor:pointer;${rowBg}">
      <td class="mono" style="color:var(--text3)">${s.id}</td>
      <td class="mono bold" style="color:${vencido ? 'var(--red)' : 'inherit'}">${s.dt?.slice(8, 10)}/${s.dt?.slice(5, 7)}</td>
      <td class="mono" style="color:var(--text3)">${s.dw || ''}</td>
      <td style="max-width:140px"><div style="display:flex;gap:3px;flex-wrap:wrap">${Services.tipoChipsHtml(s, { compact: true })}</div></td>
      <td class="bold">${Services.sanitize(s.cliente || s.cl)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text3)" title="${end}">${endTrunc}</td>
      <td class="mono">${s.horario || s.hr || '—'}</td>
      <td style="font-size:11px;color:var(--text2)">${equipeHtml}</td>
      <td><span class="chip ${st.chip}">${st.label}</span>${vencido ? '<span style="font-size:9px;color:var(--red);margin-left:3px">⏰</span>' : ''}</td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap1">
          <button class="svc-btn" style="font-size:10px;padding:3px 8px" onclick="openEditSvc(${Services.jsArg(s.id)})">✏️</button>
          ${stKey !== 'executado' ? `<button class="svc-btn exec" onclick="setSt(${Services.jsArg(s.id)}, 'executado')">✓</button>` : ''}
          ${stKey === 'agendado' ? `<button class="svc-btn reagend" onclick="setSt(${Services.jsArg(s.id)}, 'reagendado')">↻</button>` : ''}
          <button class="svc-btn cancel" onclick="setSt(${Services.jsArg(s.id)}, 'cancelado')">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderAgendaKanban(svcs) {
  const today = new Date().toISOString().split('T')[0];
  const colunas = [
    { key: 'agendado', label: '📋 Agendados', color: 'var(--blue)', chip: 'chip-blue' },
    { key: 'executado', label: '✅ Executados', color: 'var(--green)', chip: 'chip-green' },
    { key: 'reagendado', label: '🔄 Reagendados', color: 'var(--orange)', chip: 'chip-orange' },
    { key: 'cancelado', label: '❌ Cancelados', color: 'var(--red)', chip: 'chip-red' },
  ];

  const grid = document.getElementById('ag-kanban-cols');
  if (!grid) return;

  grid.innerHTML = colunas.map(col => {
    const colSvcs = svcs
      .filter(s => (s.status || s.st || 'agendado') === col.key)
      .sort((a, b) => (a.dt || '').localeCompare(b.dt || '') || (a.horario || a.hr || '').localeCompare(b.horario || b.hr || ''));

    const cards = colSvcs.slice(0, 50).map(s => {
      const F = Services.serviceFields(s);
      const stKey = F.status;
      const tipoMeta = Services.getTipoMeta(F.tipoRaw);
      const tipoCor = tipoMeta ? tipoMeta.cor : '#94a3b8';
      const semEq = !F.equipe.trim();
      const vencido = stKey === 'agendado' && s.dt < today;
      const bordaCor = vencido ? 'var(--red)' : semEq ? 'var(--orange)' : tipoCor;
      const bgCard = vencido ? 'rgba(220,38,38,.04)' : semEq ? 'rgba(234,88,12,.04)' : 'var(--bg2)';

      const badges = [
        vencido ? `<span style="font-size:9px;background:rgba(220,38,38,.12);color:var(--red);padding:1px 5px;border-radius:3px;font-family:var(--mono)">⏰ vencido</span>` : '',
        semEq ? `<span style="font-size:9px;background:rgba(234,88,12,.12);color:var(--orange);padding:1px 5px;border-radius:3px;font-family:var(--mono)">⚠ sem equipe</span>` : '',
      ].filter(Boolean).join('');

      return `<div
          draggable="true"
          data-svc-id="${Services.escapeHtmlAttr(s.id)}"
          onclick="openEditSvc(${Services.jsArg(s.id)})"
          ondragstart="agDragStart(event, ${Services.jsArg(s.id)})"
          ondragend="agDragEnd(event)"
          style="background:${bgCard};border:1px solid var(--border);border-left:3px solid ${bordaCor};border-radius:var(--r2);padding:10px 12px;cursor:grab;user-select:none;transition:opacity .12s">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:5px">
          <div style="font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${F.cliente}</div>
          ${F.horario && F.horario !== '—' ? `<span style="font-family:var(--mono);font-size:10px;background:var(--surface);border:1px solid var(--border2);border-radius:3px;padding:1px 6px;flex-shrink:0;white-space:nowrap;color:${vencido ? 'var(--red)' : 'inherit'}">${F.horario}</span>` : ''}
        </div>
        <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:4px;align-items:center">
          ${Services.tipoChipsHtml(s, { compact: true, fontSize: '9px' })}
          <span style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-left:2px">· ${s.dt?.slice(8, 10)}/${s.dt?.slice(5, 7)}</span>
        </div>
        ${F.endereco ? `<div style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px">📍 ${F.endereco.slice(0, 45)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          ${F.equipe.trim()
            ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">👷 ${F.equipe.slice(0, 28)}</span>`
            : `<span style="font-size:10px;color:var(--orange);font-weight:600">⚠ sem equipe</span>`}
          ${F.veiculo ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">🚗 ${F.veiculo}</span>` : ''}
        </div>
        ${badges ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px">${badges}</div>` : ''}
        <div style="display:flex;gap:5px" onclick="event.stopPropagation()">
          ${stKey !== 'executado' ? `<button style="flex:1;padding:3px;font-size:10px;background:var(--green);color:white;border:none;border-radius:3px;cursor:pointer;font-family:var(--mono)" onclick="setSt(${Services.jsArg(s.id)}, 'executado')">✓ Ok</button>` : '<span style="font-size:10px;color:var(--green);font-family:var(--mono)">✓ Concluído</span>'}
          <button style="padding:3px 6px;font-size:10px;border:1px solid var(--border2);border-radius:3px;cursor:pointer;background:var(--bg2)" onclick="openEditSvc(${Services.jsArg(s.id)})">✏️</button>
        </div>
      </div>`;
    }).join('');

    const extra = colSvcs.length > 50 ? `<div style="text-align:center;font-size:11px;color:var(--text3);padding:8px">+ ${colSvcs.length - 50} ocultos — filtre para ver</div>` : '';

    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;min-height:200px">
      <div style="padding:12px 14px;border-bottom:1px solid var(--border);border-top:3px solid ${col.color};display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:var(--display);font-size:13px;font-weight:800;color:${col.color}">${col.label}</div>
        <span class="chip ${col.chip}">${colSvcs.length}</span>
      </div>
      <div id="ag-drop-${col.key}" data-status="${col.key}"
        ondragover="agDragOver(event)" ondragleave="agDragLeave(event)" ondrop="agDrop(event, '${col.key}')"
        style="padding:8px;display:flex;flex-direction:column;gap:6px;max-height:620px;overflow-y:auto;flex:1;min-height:60px;transition:background .15s">
        ${cards || `<div style="text-align:center;padding:28px 16px;color:var(--text3);font-size:12px;border:2px dashed var(--border);border-radius:var(--r2);margin:4px">Arraste aqui</div>`}
        ${extra}
      </div>
    </div>`;
  }).join('');
}

function renderAgendaData(svcs, today) {
  // Implementação simplificada do calendário mensal
  const dataView = document.getElementById('ag-data-view');
  if (!dataView) return;

  // Agrupar por data
  const byDate = {};
  svcs.forEach(s => {
    const dt = s.dt || 'sem-data';
    if (!byDate[dt]) byDate[dt] = [];
    byDate[dt].push(s);
  });

  const sortedDates = Object.keys(byDate).sort();

  dataView.innerHTML = sortedDates.map(dt => {
    const daySvcs = byDate[dt];
    const dayName = dt !== 'sem-data' ? new Date(dt + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }) : 'Sem data';
    const formattedDate = dt !== 'sem-data' ? dt.split('-').reverse().join('/') : '—';

    return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-label mb2">${dayName} ${formattedDate} · ${daySvcs.length} serviço(s)</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${daySvcs.map(s => {
            const stKey = s.status || s.st || 'agendado';
            const st = Services.getStatusMeta()[stKey] || { label: stKey, chip: 'chip-gray' };
            const F = Services.serviceFields(s);
            const vencido = stKey === 'agendado' && s.dt < today;

            return `
              <div class="svc-card" onclick="openEditSvc(${Services.jsArg(s.id)})" style="border-left:3px solid ${vencido ? 'var(--red)' : 'var(--blue)'}">
                <div class="svc-header">
                  <div class="svc-cliente">${F.cliente}</div>
                  <div class="svc-meta">
                    ${Services.tipoChipsHtml(s, { compact: true })}
                    <div class="svc-hora">${F.horario}</div>
                  </div>
                </div>
                <div class="svc-actions">
                  <button class="svc-btn" onclick="openEditSvc(${Services.jsArg(s.id)})">✏️</button>
                  ${stKey !== 'executado' ? `<button class="svc-btn exec" onclick="setSt(${Services.jsArg(s.id)}, 'executado')">✓</button>` : ''}
                  ${stKey === 'agendado' ? `<button class="svc-btn reagend" onclick="setSt(${Services.jsArg(s.id)}, 'reagendado')">↻</button>` : ''}
                  <button class="svc-btn cancel" onclick="setSt(${Services.jsArg(s.id)}, 'cancelado')">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('') || '<div class="card"><div class="card-label">Nenhum serviço encontrado</div></div>';
}

function renderHoje() {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('hoje-date');
  if (dateInput && !dateInput.value) dateInput.value = today;

  const selectedDate = dateInput ? dateInput.value : today;
  const svcs = Services.getFilteredServices().filter(s => s.dt === selectedDate);

  // Atualizar título
  const titleEl = document.getElementById('hoje-title');
  if (titleEl) {
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const dayName = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    titleEl.textContent = `${dayName}, ${formattedDate}`;
  }

  // Atualizar contador
  const countEl = document.getElementById('hoje-count');
  if (countEl) countEl.textContent = `${svcs.length} serviço(s)`;

  // Renderizar serviços
  const container = document.getElementById('hoje-services');
  if (!container) return;

  if (!svcs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:48px;margin-bottom:16px">📅</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhum serviço agendado</div>
        <div style="font-size:12px;color:var(--text3)">Para este dia não há serviços programados.</div>
      </div>
    `;
    return;
  }

  // Ordenar por horário
  const sortedSvcs = [...svcs].sort((a, b) => {
    const aTime = a.horario || a.hr || '23:59';
    const bTime = b.horario || b.hr || '23:59';
    return aTime.localeCompare(bTime);
  });

  container.innerHTML = sortedSvcs.map(s => {
    const F = Services.serviceFields(s);
    const stKey = F.status;
    const st = Services.getStatusMeta()[stKey] || { label: stKey, chip: 'chip-gray' };
    const semEq = !F.equipe.trim();
    const tipos = Services.extractServiceTypes(s);

    return `
      <div class="svc-card ${stKey === 'executado' ? 'executed' : ''}" onclick="openEditSvc(${Services.jsArg(s.id)})">
        <div class="svc-header">
          <div class="svc-cliente">${F.cliente}</div>
          <div class="svc-meta">
            ${Services.tipoChipsHtml(s, { compact: true })}
            <div class="svc-hora">${F.horario}</div>
          </div>
        </div>
        <div class="svc-content">
          ${F.endereco && F.endereco !== '—' ? `<div class="svc-endereco">📍 ${F.endereco}</div>` : ''}
          <div class="svc-equipe ${semEq ? 'sem-equipe' : ''}">
            ${semEq ? '⚠ Sem equipe definida' : `👷 ${F.equipe}`}
          </div>
          ${F.veiculo ? `<div class="svc-veiculo">🚗 ${F.veiculo}</div>` : ''}
        </div>
        <div class="svc-actions">
          <button class="svc-btn" onclick="openEditSvc(${Services.jsArg(s.id)})">✏️</button>
          ${stKey !== 'executado' ? `<button class="svc-btn exec" onclick="setSt(${Services.jsArg(s.id)}, 'executado')">✓</button>` : '<span class="svc-status-executed">✅ Executado</span>'}
          ${stKey === 'agendado' ? `<button class="svc-btn reagend" onclick="setSt(${Services.jsArg(s.id)}, 'reagendado')">↻</button>` : ''}
          <button class="svc-btn cancel" onclick="setSt(${Services.jsArg(s.id)}, 'cancelado')">✕</button>
        </div>
        <div class="svc-status">
          <span class="chip ${st.chip}">${st.label}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderRoteiro() {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('rot-data');
  if (dateInput && !dateInput.value) dateInput.value = today;

  const selectedDate = dateInput ? dateInput.value : today;
  const svcs = Services.getFilteredServices().filter(s => s.dt === selectedDate);

  // Atualizar título
  const titleEl = document.getElementById('rot-title');
  if (titleEl) {
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const dayName = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    const formattedDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    titleEl.textContent = `Roteiro - ${dayName}, ${formattedDate}`;
  }

  const container = document.getElementById('rot-container');
  if (!container) return;

  if (!svcs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:48px;margin-bottom:16px">🗺</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhum serviço para roteirizar</div>
        <div style="font-size:12px;color:var(--text3)">Para este dia não há serviços programados.</div>
      </div>
    `;
    return;
  }

  // Ordenar por horário e calcular rota otimizada
  const sortedSvcs = [...svcs].sort((a, b) => {
    const aTime = a.horario || a.hr || '23:59';
    const bTime = b.horario || b.hr || '23:59';
    return aTime.localeCompare(bTime);
  });

  // Calcular estatísticas da rota
  let totalKm = 0;
  let tempoTotal = 0;
  const enderecos = sortedSvcs.map(s => s.endereco || '').filter(e => e);

  for (let i = 1; i < sortedSvcs.length; i++) {
    const prev = sortedSvcs[i - 1];
    const curr = sortedSvcs[i];
    totalKm += Services.estimateDistance(prev.endereco || '', curr.endereco || '');
    tempoTotal += 90; // assume 90min por serviço
  }

  // Renderizar estatísticas
  const statsEl = document.getElementById('rot-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${sortedSvcs.length}</div>
        <div class="stat-label">Serviços</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${totalKm.toFixed(1)}km</div>
        <div class="stat-label">Distância</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${Math.floor(tempoTotal / 60)}h${tempoTotal % 60 ? String(tempoTotal % 60).padStart(2, '0') : ''}</div>
        <div class="stat-label">Tempo estimado</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${enderecos.length}</div>
        <div class="stat-label">Endereços únicos</div>
      </div>
    `;
  }

  // Renderizar lista de serviços
  container.innerHTML = sortedSvcs.map((s, index) => {
    const F = Services.serviceFields(s);
    const stKey = F.status;
    const st = Services.getStatusMeta()[stKey] || { label: stKey, chip: 'chip-gray' };
    const semEq = !F.equipe.trim();

    // Calcular tempo até o próximo
    const nextSvc = sortedSvcs[index + 1];
    const kmToNext = nextSvc ? Services.estimateDistance(s.endereco || '', nextSvc.endereco || '') : 0;

    return `
      <div class="rot-item ${stKey === 'executado' ? 'executed' : ''}">
        <div class="rot-number">${index + 1}</div>
        <div class="rot-content">
          <div class="rot-header">
            <div class="rot-cliente">${F.cliente}</div>
            <div class="rot-time">${F.horario}</div>
          </div>
          <div class="rot-details">
            ${F.endereco && F.endereco !== '—' ? `<div class="rot-endereco">📍 ${F.endereco}</div>` : ''}
            <div class="rot-meta">
              ${Services.tipoChipsHtml(s, { compact: true })}
              <div class="rot-equipe ${semEq ? 'sem-equipe' : ''}">
                ${semEq ? '⚠ Sem equipe' : `👷 ${F.equipe}`}
              </div>
              ${F.veiculo ? `<div class="rot-veiculo">🚗 ${F.veiculo}</div>` : ''}
            </div>
          </div>
          ${nextSvc ? `
            <div class="rot-next">
              <div class="rot-next-label">Próximo: ${nextSvc.cliente || nextSvc.cl || '—'}</div>
              <div class="rot-next-meta">${kmToNext.toFixed(1)}km • ~${Math.ceil(kmToNext * 3)}min</div>
            </div>
          ` : ''}
        </div>
        <div class="rot-actions">
          <button class="svc-btn" onclick="openEditSvc(${Services.jsArg(s.id)})">✏️</button>
          ${stKey !== 'executado' ? `<button class="svc-btn exec" onclick="setSt(${Services.jsArg(s.id)}, 'executado')">✓</button>` : ''}
          ${stKey === 'agendado' ? `<button class="svc-btn reagend" onclick="setSt(${Services.jsArg(s.id)}, 'reagendado')">↻</button>` : ''}
          <button class="svc-btn cancel" onclick="setSt(${Services.jsArg(s.id)}, 'cancelado')">✕</button>
        </div>
        <div class="rot-status">
          <span class="chip ${st.chip}">${st.label}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderRotas() {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('rota-date');
  if (dateInput && !dateInput.value) dateInput.value = today;

  const selectedDate = dateInput ? dateInput.value : today;
  const svcs = Services.getFilteredServices().filter(s => s.dt === selectedDate);

  const container = document.getElementById('rotas-container');
  if (!container) return;

  if (!svcs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:48px;margin-bottom:16px">🗺</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhuma rota para analisar</div>
        <div style="font-size:12px;color:var(--text3)">Para este dia não há serviços programados.</div>
      </div>
    `;
    return;
  }

  // Agrupar por equipe
  const byTeam = {};
  svcs.forEach(s => {
    const team = Services.getServiceTeam(s) || 'Sem equipe';
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(s);
  });

  // Calcular métricas por equipe
  const teamMetrics = Object.entries(byTeam).map(([team, teamSvcs]) => {
    const sortedSvcs = [...teamSvcs].sort((a, b) => {
      const aTime = a.horario || a.hr || '23:59';
      const bTime = b.horario || b.hr || '23:59';
      return aTime.localeCompare(bTime);
    });

    let totalKm = 0;
    let tempoTotal = 0;
    const enderecos = new Set();

    for (let i = 1; i < sortedSvcs.length; i++) {
      const prev = sortedSvcs[i - 1];
      const curr = sortedSvcs[i];
      totalKm += Services.estimateDistance(prev.endereco || '', curr.endereco || '');
      tempoTotal += 90; // assume 90min por serviço
    }

    sortedSvcs.forEach(s => {
      if (s.endereco) enderecos.add(s.endereco);
    });

    const eficiencia = sortedSvcs.length > 1 ? (totalKm / (sortedSvcs.length - 1)).toFixed(1) : 0;

    return {
      team,
      services: sortedSvcs,
      totalKm,
      tempoTotal,
      enderecosUnicos: enderecos.size,
      eficiencia,
      servicosCount: sortedSvcs.length
    };
  });

  // Renderizar métricas gerais
  const totalKmGeral = teamMetrics.reduce((sum, m) => sum + m.totalKm, 0);
  const totalServicos = svcs.length;
  const enderecosUnicosGeral = new Set(svcs.map(s => s.endereco).filter(e => e)).size;

  const metricsEl = document.getElementById('rotas-metrics');
  if (metricsEl) {
    metricsEl.innerHTML = `
      <div class="metric-card">
        <div class="metric-value">${totalServicos}</div>
        <div class="metric-label">Total de Serviços</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${totalKmGeral.toFixed(1)}km</div>
        <div class="metric-label">KM Totais</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${enderecosUnicosGeral}</div>
        <div class="metric-label">Endereços Únicos</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${(totalKmGeral / Math.max(totalServicos - teamMetrics.length, 1)).toFixed(1)}km</div>
        <div class="metric-label">KM Médio por Serviço</div>
      </div>
    `;
  }

  // Renderizar rotas por equipe
  container.innerHTML = teamMetrics.map(metric => `
    <div class="rota-team-card">
      <div class="rota-team-header">
        <div class="rota-team-name">${metric.team}</div>
        <div class="rota-team-stats">
          <span class="stat">${metric.servicosCount} serviços</span>
          <span class="stat">${metric.totalKm.toFixed(1)}km</span>
          <span class="stat">${metric.enderecosUnicos} endereços</span>
        </div>
      </div>
      <div class="rota-services">
        ${metric.services.map((s, index) => {
          const F = Services.serviceFields(s);
          const nextSvc = metric.services[index + 1];
          const kmToNext = nextSvc ? Services.estimateDistance(s.endereco || '', nextSvc.endereco || '') : 0;

          return `
            <div class="rota-service-item">
              <div class="rota-service-number">${index + 1}</div>
              <div class="rota-service-info">
                <div class="rota-service-cliente">${F.cliente}</div>
                <div class="rota-service-time">${F.horario}</div>
                ${F.endereco ? `<div class="rota-service-address">📍 ${F.endereco}</div>` : ''}
              </div>
              ${nextSvc ? `
                <div class="rota-service-next">
                  <div class="rota-next-arrow">→</div>
                  <div class="rota-next-info">
                    <div class="rota-next-cliente">${nextSvc.cliente || nextSvc.cl || '—'}</div>
                    <div class="rota-next-distance">${kmToNext.toFixed(1)}km</div>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div class="rota-efficiency">
        <div class="efficiency-label">Eficiência da rota:</div>
        <div class="efficiency-value ${metric.eficiencia < 3 ? 'good' : metric.eficiencia < 5 ? 'medium' : 'poor'}">
          ${metric.eficiencia}km médio entre serviços
        </div>
      </div>
    </div>
  `).join('');
}

function renderCheckList() {
  const today = new Date().toISOString().split('T')[0];

  // Preencher data se vazia
  const dataEl = document.getElementById('cl-data');
  if (dataEl && !dataEl.value) dataEl.value = today;

  // Carregar dados do último checklist se existir
  const lastRecord = Services.getCheckListRecords()
    .filter(r => r.date === today)
    .sort((a, b) => new Date(b.date + 'T' + (b.hC || '00:00')) - new Date(a.date + 'T' + (a.hC || '00:00')))[0];

  if (lastRecord) {
    // Preencher campos com dados do último registro
    UI.setInputValue('cl-motor', lastRecord.motor || '');
    UI.setInputValue('cl-assist', lastRecord.assist || '');
    document.getElementById('cl-vei').value = lastRecord.vei || '';
    UI.setInputValue('cl-kms', lastRecord.kmS || '');
    UI.setInputValue('cl-kmc', lastRecord.kmC || '');
    UI.setInputValue('cl-hs', lastRecord.hS || '');
    UI.setInputValue('cl-hc', lastRecord.hC || '');
    document.getElementById('cl-fuel').value = lastRecord.fuel || '';
    UI.setInputValue('cl-obs', lastRecord.obs || '');

    // Calcular KM automaticamente
    calcKM();
  }

  // Renderizar histórico do dia
  const todayRecords = Services.getCheckListRecords().filter(r => r.date === today);
  const historyEl = document.getElementById('cl-history');
  if (historyEl) {
    if (todayRecords.length > 0) {
      historyEl.innerHTML = `
        <div class="card">
          <div class="card-label">Registros de hoje (${todayRecords.length})</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
            ${todayRecords.map(r => `
              <div class="cl-record">
                <div class="cl-record-header">
                  <span class="cl-record-vei">${r.vei || '—'}</span>
                  <span class="cl-record-time">${r.hC || r.hS || '—'}</span>
                </div>
                <div class="cl-record-details">
                  <span>KM: ${r.kmS || 0} → ${r.kmC || 0} (${r.kmD || 0}km)</span>
                  <span>Combustível: ${r.fuel || '—'}</span>
                  ${r.obs ? `<span>Obs: ${r.obs}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      historyEl.innerHTML = '<div class="text-muted">Nenhum registro para hoje ainda.</div>';
    }
  }
}

function renderFrota() {
  const records = Services.getCheckListRecords();

  if (!records.length) {
    const page = document.getElementById('page-frota');
    if (page) {
      page.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px">🚗</div>
          <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhum registro de frota</div>
          <div style="font-size:12px;color:var(--text3)">Os dados da frota aparecerão aqui após os primeiros check-lists.</div>
        </div>
      `;
    }
    return;
  }

  // Agrupar por veículo
  const byVeic = {};
  records.forEach(r => {
    if (!r.vei) return;
    if (!byVeic[r.vei]) {
      byVeic[r.vei] = {
        records: [],
        totalKm: 0,
        avgFuel: {},
        lastKm: 0,
        firstDate: null,
        lastDate: null
      };
    }
    byVeic[r.vei].records.push(r);
    byVeic[r.vei].totalKm += r.kmD || 0;

    if (r.fuel) {
      byVeic[r.vei].avgFuel[r.fuel] = (byVeic[r.vei].avgFuel[r.fuel] || 0) + 1;
    }

    const recordDate = new Date(r.date);
    if (!byVeic[r.vei].firstDate || recordDate < byVeic[r.vei].firstDate) {
      byVeic[r.vei].firstDate = recordDate;
    }
    if (!byVeic[r.vei].lastDate || recordDate > byVeic[r.vei].lastDate) {
      byVeic[r.vei].lastDate = recordDate;
      byVeic[r.vei].lastKm = r.kmC || 0;
    }
  });

  // Calcular estatísticas por veículo
  const veicStats = Object.entries(byVeic).map(([vei, data]) => {
    const days = data.records.length;
    const avgKmPerDay = days > 0 ? (data.totalKm / days).toFixed(1) : 0;
    const mostCommonFuel = Object.entries(data.avgFuel).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    // Calcular consumo médio (simplificado)
    const fuelRecords = data.records.filter(r => r.fuel && r.kmD > 0);
    const avgConsumption = fuelRecords.length > 0
      ? (fuelRecords.reduce((sum, r) => sum + (r.kmD / 10), 0) / fuelRecords.length).toFixed(1) // assume 10km/L médio
      : '—';

    return {
      vei,
      totalKm: data.totalKm,
      days,
      avgKmPerDay,
      mostCommonFuel,
      avgConsumption,
      lastKm: data.lastKm,
      records: data.records.sort((a, b) => new Date(b.date) - new Date(a.date))
    };
  }).sort((a, b) => b.totalKm - a.totalKm);

  const container = document.getElementById('frota-container');
  if (container) {
    container.innerHTML = veicStats.map(stat => `
      <div class="frota-veic-card">
        <div class="frota-veic-header">
          <div class="frota-veic-name">🚗 ${stat.vei}</div>
          <div class="frota-veic-km">${stat.totalKm.toLocaleString('pt-BR')} km total</div>
        </div>
        <div class="frota-veic-stats">
          <div class="frota-stat">
            <div class="frota-stat-value">${stat.days}</div>
            <div class="frota-stat-label">dias de uso</div>
          </div>
          <div class="frota-stat">
            <div class="frota-stat-value">${stat.avgKmPerDay}km</div>
            <div class="frota-stat-label">média/dia</div>
          </div>
          <div class="frota-stat">
            <div class="frota-stat-value">${stat.mostCommonFuel}</div>
            <div class="frota-stat-label">comb. comum</div>
          </div>
          <div class="frota-stat">
            <div class="frota-stat-value">${stat.avgConsumption}km/L</div>
            <div class="frota-stat-label">consumo médio</div>
          </div>
        </div>
        <div class="frota-veic-records">
          <div class="frota-records-header">Últimos registros</div>
          <div class="frota-records-list">
            ${stat.records.slice(0, 5).map(r => `
              <div class="frota-record">
                <div class="frota-record-date">${new Date(r.date).toLocaleDateString('pt-BR')}</div>
                <div class="frota-record-km">${r.kmS || 0} → ${r.kmC || 0} (${r.kmD || 0}km)</div>
                <div class="frota-record-fuel">${r.fuel || '—'}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('');
  }

  // Renderizar estatísticas gerais
  const totalKmGeral = veicStats.reduce((sum, s) => sum + s.totalKm, 0);
  const totalDays = records.length;
  const uniqueVeics = veicStats.length;

  const statsEl = document.getElementById('frota-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="frota-stat-card">
        <div class="frota-stat-value">${uniqueVeics}</div>
        <div class="frota-stat-label">veículos ativos</div>
      </div>
      <div class="frota-stat-card">
        <div class="frota-stat-value">${totalKmGeral.toLocaleString('pt-BR')}</div>
        <div class="frota-stat-label">km totais percorridos</div>
      </div>
      <div class="frota-stat-card">
        <div class="frota-stat-value">${totalDays}</div>
        <div class="frota-stat-label">registros realizados</div>
      </div>
      <div class="frota-stat-card">
        <div class="frota-stat-value">${(totalKmGeral / Math.max(totalDays, 1)).toFixed(0)}km</div>
        <div class="frota-stat-label">média por registro</div>
      </div>
    `;
  }
}

function renderEquipes() {
  const teams = Services.getUniqueTeams();

  if (!teams.length) {
    const page = document.getElementById('page-equipes');
    if (page) {
      page.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px">👷</div>
          <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhuma equipe encontrada</div>
          <div style="font-size:12px;color:var(--text3)">As equipes aparecerão aqui após a definição nos serviços.</div>
        </div>
      `;
    }
    return;
  }

  // Calcular estatísticas por equipe
  const teamStats = teams.map(team => {
    const teamServices = Services.getServicesByTeam(team);
    const executed = teamServices.filter(s => (s.status || s.st) === 'executado').length;
    const total = teamServices.length;
    const tx = total > 0 ? Math.round(executed / total * 100) : 0;

    // Serviços por mês
    const byMonth = {};
    teamServices.forEach(s => {
      const ms = s.ms || (s.dt ? s.dt.substring(5, 7) : '00');
      byMonth[ms] = (byMonth[ms] || 0) + 1;
    });

    // Próximos serviços (próximos 7 dias)
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const upcoming = teamServices.filter(s => {
      if (!s.dt) return false;
      const svcDate = new Date(s.dt);
      return svcDate >= today && svcDate <= nextWeek && (s.status || s.st) === 'agendado';
    });

    // Últimos serviços executados
    const recent = teamServices
      .filter(s => (s.status || s.st) === 'executado')
      .sort((a, b) => new Date(b.dt || '1970-01-01') - new Date(a.dt || '1970-01-01'))
      .slice(0, 3);

    return {
      team,
      total,
      executed,
      tx,
      byMonth,
      upcoming,
      recent
    };
  }).sort((a, b) => b.total - a.total);

  const container = document.getElementById('equipes-container');
  if (container) {
    container.innerHTML = teamStats.map(stat => `
      <div class="equipe-card">
        <div class="equipe-header">
          <div class="equipe-name">👷 ${stat.team}</div>
          <div class="equipe-stats">
            <span class="equipe-stat">${stat.total} serviços</span>
            <span class="equipe-stat ${stat.tx >= 70 ? 'good' : stat.tx >= 50 ? 'medium' : 'poor'}">${stat.tx}% executados</span>
          </div>
        </div>

        <div class="equipe-content">
          <div class="equipe-section">
            <div class="equipe-section-title">Próximos 7 dias</div>
            ${stat.upcoming.length > 0 ? `
              <div class="equipe-upcoming">
                ${stat.upcoming.slice(0, 3).map(s => `
                  <div class="equipe-upcoming-item">
                    <div class="equipe-upcoming-date">${new Date(s.dt).toLocaleDateString('pt-BR')}</div>
                    <div class="equipe-upcoming-client">${s.cliente || s.cl || '—'}</div>
                    <div class="equipe-upcoming-time">${s.horario || s.hr || '—'}</div>
                  </div>
                `).join('')}
                ${stat.upcoming.length > 3 ? `<div class="equipe-more">+ ${stat.upcoming.length - 3} mais...</div>` : ''}
              </div>
            ` : '<div class="equipe-empty">Nenhum serviço agendado</div>'}
          </div>

          <div class="equipe-section">
            <div class="equipe-section-title">Últimos executados</div>
            ${stat.recent.length > 0 ? `
              <div class="equipe-recent">
                ${stat.recent.map(s => `
                  <div class="equipe-recent-item">
                    <div class="equipe-recent-date">${new Date(s.dt).toLocaleDateString('pt-BR')}</div>
                    <div class="equipe-recent-client">${s.cliente || s.cl || '—'}</div>
                  </div>
                `).join('')}
              </div>
            ` : '<div class="equipe-empty">Nenhum serviço executado ainda</div>'}
          </div>

          <div class="equipe-section">
            <div class="equipe-section-title">Atividade mensal</div>
            <div class="equipe-months">
              ${Object.entries(stat.byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, count]) => `
                <div class="equipe-month">
                  <div class="equipe-month-label">${Services.mesLabel(month)}</div>
                  <div class="equipe-month-value">${count}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }
}

function renderClientes() {
  const clients = Services.getUniqueClients();

  if (!clients.length) {
    const page = document.getElementById('page-clientes');
    if (page) {
      page.innerHTML = `
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px">👥</div>
          <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhum cliente encontrado</div>
          <div style="font-size:12px;color:var(--text3)">Os clientes aparecerão aqui após a criação dos primeiros serviços.</div>
        </div>
      `;
    }
    return;
  }

  // Calcular estatísticas por cliente
  const clientStats = clients.map(client => {
    const clientServices = Services.getServices().filter(s => (s.cliente || s.cl) === client);
    const executed = clientServices.filter(s => (s.status || s.st) === 'executado').length;
    const total = clientServices.length;
    const tx = total > 0 ? Math.round(executed / total * 100) : 0;

    // Valor estimado (simplificado - baseado em tipos de serviço)
    let valorEstimado = 0;
    clientServices.forEach(s => {
      const tipos = Services.extractServiceTypes(s);
      if (tipos.includes('INST')) valorEstimado += 150;
      else if (tipos.includes('MAN')) valorEstimado += 80;
      else if (tipos.includes('REP')) valorEstimado += 100;
      else valorEstimado += 50;
    });

    // Último serviço
    const lastService = clientServices
      .filter(s => s.dt)
      .sort((a, b) => new Date(b.dt) - new Date(a.dt))[0];

    // Próximo serviço agendado
    const nextService = clientServices
      .filter(s => s.dt && (s.status || s.st) === 'agendado')
      .sort((a, b) => new Date(a.dt) - new Date(b.dt))[0];

    // Endereços únicos
    const enderecos = [...new Set(clientServices.map(s => s.endereco).filter(e => e))];

    return {
      client,
      total,
      executed,
      tx,
      valorEstimado,
      lastService,
      nextService,
      enderecos
    };
  }).sort((a, b) => b.total - a.total);

  const container = document.getElementById('clientes-container');
  if (container) {
    container.innerHTML = clientStats.map(stat => `
      <div class="cliente-card">
        <div class="cliente-header">
          <div class="cliente-name">🏢 ${stat.client}</div>
          <div class="cliente-stats">
            <span class="cliente-stat">${stat.total} serviços</span>
            <span class="cliente-stat ${stat.tx >= 70 ? 'good' : stat.tx >= 50 ? 'medium' : 'poor'}">${stat.tx}% executados</span>
          </div>
        </div>

        <div class="cliente-content">
          <div class="cliente-section">
            <div class="cliente-section-title">Valor estimado</div>
            <div class="cliente-valor">R$ ${stat.valorEstimado.toLocaleString('pt-BR')}</div>
          </div>

          <div class="cliente-section">
            <div class="cliente-section-title">Último serviço</div>
            ${stat.lastService ? `
              <div class="cliente-last-service">
                <div class="cliente-service-date">${new Date(stat.lastService.dt).toLocaleDateString('pt-BR')}</div>
                <div class="cliente-service-type">${Services.tipoChipsHtml(stat.lastService, { compact: true })}</div>
                <div class="cliente-service-status">
                  <span class="chip ${Services.getStatusMeta()[stat.lastService.status || stat.lastService.st || 'agendado']?.chip || 'chip-gray'}">
                    ${Services.getStatusMeta()[stat.lastService.status || stat.lastService.st || 'agendado']?.label || '—'}
                  </span>
                </div>
              </div>
            ` : '<div class="cliente-empty">Nenhum serviço executado</div>'}
          </div>

          <div class="cliente-section">
            <div class="cliente-section-title">Próximo agendamento</div>
            ${stat.nextService ? `
              <div class="cliente-next-service">
                <div class="cliente-service-date">${new Date(stat.nextService.dt).toLocaleDateString('pt-BR')}</div>
                <div class="cliente-service-type">${Services.tipoChipsHtml(stat.nextService, { compact: true })}</div>
                <div class="cliente-service-time">${stat.nextService.horario || stat.nextService.hr || '—'}</div>
              </div>
            ` : '<div class="cliente-empty">Nenhum agendamento futuro</div>'}
          </div>

          ${stat.enderecos.length > 0 ? `
            <div class="cliente-section">
              <div class="cliente-section-title">Endereços (${stat.enderecos.length})</div>
              <div class="cliente-enderecos">
                ${stat.enderecos.slice(0, 2).map(end => `<div class="cliente-endereco">📍 ${end}</div>`).join('')}
                ${stat.enderecos.length > 2 ? `<div class="cliente-more">+ ${stat.enderecos.length - 2} endereços</div>` : ''}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  // Estatísticas gerais
  const totalClientes = clientStats.length;
  const totalServicos = clientStats.reduce((sum, c) => sum + c.total, 0);
  const valorTotal = clientStats.reduce((sum, c) => sum + c.valorEstimado, 0);
  const avgServicosPorCliente = (totalServicos / totalClientes).toFixed(1);

  const statsEl = document.getElementById('clientes-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="cliente-stat-card">
        <div class="cliente-stat-value">${totalClientes}</div>
        <div class="cliente-stat-label">clientes ativos</div>
      </div>
      <div class="cliente-stat-card">
        <div class="cliente-stat-value">${totalServicos}</div>
        <div class="cliente-stat-label">serviços totais</div>
      </div>
      <div class="cliente-stat-card">
        <div class="cliente-stat-value">R$ ${valorTotal.toLocaleString('pt-BR')}</div>
        <div class="cliente-stat-label">valor estimado</div>
      </div>
      <div class="cliente-stat-card">
        <div class="cliente-stat-value">${avgServicosPorCliente}</div>
        <div class="cliente-stat-label">serviços/cliente</div>
      </div>
    `;
  }
}

function renderHist() {
  const records = Services.getCheckListRecords();

  // Aplicar filtros
  const motorFilter = document.getElementById('hist-mot')?.value || '';
  const veicFilter = document.getElementById('hist-vei')?.value || '';

  let filteredRecords = records;
  if (motorFilter) {
    filteredRecords = filteredRecords.filter(r => r.motor === motorFilter);
  }
  if (veicFilter) {
    filteredRecords = filteredRecords.filter(r => r.vei === veicFilter);
  }

  // Ordenar por data decrescente
  filteredRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

  const container = document.getElementById('hist-container');
  if (!container) return;

  if (!filteredRecords.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:48px;margin-bottom:16px">📋</div>
        <div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">Nenhum registro encontrado</div>
        <div style="font-size:12px;color:var(--text3)">${motorFilter || veicFilter ? 'Tente ajustar os filtros.' : 'Os registros de check-list aparecerão aqui.'}</div>
      </div>
    `;
    return;
  }

  // Calcular estatísticas
  const totalKm = filteredRecords.reduce((sum, r) => sum + (r.kmD || 0), 0);
  const avgKm = filteredRecords.length > 0 ? (totalKm / filteredRecords.length).toFixed(1) : 0;
  const uniqueVeics = [...new Set(filteredRecords.map(r => r.vei).filter(v => v))].length;
  const dateRange = filteredRecords.length > 1
    ? `${new Date(filteredRecords[filteredRecords.length - 1].date).toLocaleDateString('pt-BR')} - ${new Date(filteredRecords[0].date).toLocaleDateString('pt-BR')}`
    : filteredRecords[0]?.date ? new Date(filteredRecords[0].date).toLocaleDateString('pt-BR') : '—';

  const statsEl = document.getElementById('hist-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="hist-stat-card">
        <div class="hist-stat-value">${filteredRecords.length}</div>
        <div class="hist-stat-label">registros</div>
      </div>
      <div class="hist-stat-card">
        <div class="hist-stat-value">${totalKm.toLocaleString('pt-BR')}km</div>
        <div class="hist-stat-label">km totais</div>
      </div>
      <div class="hist-stat-card">
        <div class="hist-stat-value">${avgKm}km</div>
        <div class="hist-stat-label">média/registro</div>
      </div>
      <div class="hist-stat-card">
        <div class="hist-stat-value">${uniqueVeics}</div>
        <div class="hist-stat-label">veículos</div>
      </div>
    `;
  }

  // Renderizar tabela
  container.innerHTML = `
    <div class="hist-table-container">
      <table class="hist-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Motorista</th>
            <th>Ajudante</th>
            <th>Veículo</th>
            <th>KM Inicial</th>
            <th>KM Final</th>
            <th>KM Percorrido</th>
            <th>Combustível</th>
            <th>Hora Saída</th>
            <th>Hora Chegada</th>
            <th>Observações</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRecords.map(r => `
            <tr>
              <td class="hist-date">${new Date(r.date).toLocaleDateString('pt-BR')}</td>
              <td class="hist-motor">${r.motor || '—'}</td>
              <td class="hist-assist">${r.assist || '—'}</td>
              <td class="hist-veic">${r.vei || '—'}</td>
              <td class="hist-km">${r.kmS || '—'}</td>
              <td class="hist-km">${r.kmC || '—'}</td>
              <td class="hist-km ${r.kmD > 0 ? 'positive' : ''}">${r.kmD || '—'}</td>
              <td class="hist-fuel">${r.fuel || '—'}</td>
              <td class="hist-time">${r.hS || '—'}</td>
              <td class="hist-time">${r.hC || '—'}</td>
              <td class="hist-obs">${r.obs || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Preencher filtros
  const motorSelect = document.getElementById('hist-mot');
  const veicSelect = document.getElementById('hist-vei');

  if (motorSelect) {
    const motors = [...new Set(records.map(r => r.motor).filter(m => m))].sort();
    motorSelect.innerHTML = '<option value="">Todos os motoristas</option>' +
      motors.map(m => `<option value="${m}" ${m === motorFilter ? 'selected' : ''}>${m}</option>`).join('');
  }

  if (veicSelect) {
    const veics = [...new Set(records.map(r => r.vei).filter(v => v))].sort();
    veicSelect.innerHTML = '<option value="">Todos os veículos</option>' +
      veics.map(v => `<option value="${v}" ${v === veicFilter ? 'selected' : ''}>${v}</option>`).join('');
  }
}

// ============================================
// FUNÇÕES AUXILIARES HOJE
// ============================================

function moveDateToday(days) {
  const dateInput = document.getElementById('hoje-date');
  if (dateInput && dateInput.value) {
    const date = new Date(dateInput.value + 'T00:00:00');
    date.setDate(date.getDate() + days);
    dateInput.value = date.toISOString().split('T')[0];
    renderHoje();
  }
}

function goToToday() {
  const dateInput = document.getElementById('hoje-date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    renderHoje();
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function setAgendaView(view) {
  ['list', 'kanban', 'data'].forEach(v => {
    const btn = document.getElementById(`ag-view-${v}`);
    if (btn) btn.style.background = v === view ? 'var(--blue)' : '';
  });
}

function clearCheckList() {
  ['cl-data', 'cl-motor', 'cl-assist', 'cl-cartao', 'cl-kms', 'cl-kmc', 'cl-hs', 'cl-hc', 'cl-obs'].forEach(id => {
    UI.clearInput(id);
  });
  document.getElementById('cl-vei').value = '';
  document.getElementById('cl-fuel').value = '';
  UI.showToast('Check List limpo', 'ok');
}

function saveCheckList() {
  const record = {
    date: UI.getInputValue('cl-data'),
    motor: UI.getInputValue('cl-motor'),
    assist: UI.getInputValue('cl-assist'),
    vei: document.getElementById('cl-vei').value,
    kmS: parseInt(UI.getInputValue('cl-kms')) || 0,
    kmC: parseInt(UI.getInputValue('cl-kmc')) || 0,
    kmD: (parseInt(UI.getInputValue('cl-kmc')) || 0) - (parseInt(UI.getInputValue('cl-kms')) || 0),
    hS: UI.getInputValue('cl-hs'),
    hC: UI.getInputValue('cl-hc'),
    fuel: document.getElementById('cl-fuel').value,
    obs: UI.getInputValue('cl-obs'),
  };

  Services.addCheckListRecord(record);
  UI.showToast('✅ Check List salvo!', 'ok');
  clearCheckList();
}

function calcKM() {
  const kmS = parseInt(UI.getInputValue('cl-kms')) || 0;
  const kmC = parseInt(UI.getInputValue('cl-kmc')) || 0;
  const kmD = kmC - kmS;

  if (kmD > 0) {
    UI.show('km-preview');
    UI.setText('km-s', kmS.toLocaleString('pt-BR'));
    UI.setText('km-c', kmC.toLocaleString('pt-BR'));
    UI.setText('km-d', kmD.toLocaleString('pt-BR'));
  } else {
    UI.hide('km-preview');
  }
}

function toggleAvariaField() {
  const field = document.getElementById('avaria-field');
  const cb = document.getElementById('cl-av-cb');
  if (cb.checked) {
    UI.show('avaria-field');
  } else {
    UI.hide('avaria-field');
  }
}

function checkAllEquipments() {
  document.querySelectorAll('.eitem input[type=checkbox]').forEach(cb => {
    cb.checked = true;
    cb.parentElement.classList.add('chk');
  });
}

function uncheckAllEquipments() {
  document.querySelectorAll('.eitem input[type=checkbox]').forEach(cb => {
    cb.checked = false;
    cb.parentElement.classList.remove('chk');
  });
}

function saveImport() {
  const record = {
    kmC: parseInt(UI.getInputValue('imp-kmc')) || 0,
    hS: UI.getInputValue('imp-hs'),
    hC: UI.getInputValue('imp-hc'),
    fuel: UI.getInputValue('imp-fuel'),
    obs: UI.getInputValue('imp-obs'),
    avaria: UI.getInputValue('imp-avt')
  };

  Services.addCheckListRecord(record);
  UI.showToast('✅ Histórico importado!', 'ok');
  clearImport();
}

function clearImport() {
  ['imp-dt', 'imp-mot', 'imp-ass', 'imp-vei', 'imp-kms', 'imp-kmc', 'imp-hs', 'imp-hc', 'imp-fuel', 'imp-obs', 'imp-avt'].forEach(id => {
    UI.clearInput(id);
  });
}

function exportCSV() {
  const svcs = Services.getServices();
  let csv = 'Data,Cliente,Tipo,Status,Equipe\n';
  svcs.forEach(s => {
    csv += `"${s.dt || ''}","${s.cliente || s.cl || ''}","${s.tipoServico || s.sc || ''}","${s.status || s.st || ''}","${s.equipe || s.eq || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'letec-export.csv';
  link.click();
  UI.showToast('📥 CSV exportado!', 'ok');
}

// ============================================
// FUNÇÕES GERAIS
// ============================================

function setSt(svcId, newStatus) {
  Services.updateService(svcId, { status: newStatus });
  renderAgenda();
  const statusMeta = Services.getStatusMeta()[newStatus] || { label: newStatus };
  UI.showToast(`✅ Status alterado para "${statusMeta.label}"`, 'ok');

  // Atualizar badges
  UI.updateBadges(
    Services.getServicesByStatus('agendado').length,
    Services.getServicesByStatus('executado').length,
    0,
    0
  );
}

function openEditSvc(svcId) {
  const svc = Services.getServiceById(svcId);
  if (!svc) {
    UI.showToast('❌ Serviço não encontrado', 'error');
    return;
  }

  // Por enquanto, apenas mostrar toast com ID
  UI.showToast(`📝 Editar serviço #${svcId}`, 'info');
  // TODO: Implementar modal de edição
}

// ============================================
// FUNÇÕES AGENDA (DRAG & DROP)
// ============================================

let draggedSvcId = null;

function agDragStart(event, svcId) {
  draggedSvcId = svcId;
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
}

function agDragEnd(event) {
  event.target.style.opacity = '1';
  draggedSvcId = null;
}

function agDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.style.background = 'rgba(37, 99, 235, 0.1)';
}

function agDragLeave(event) {
  event.currentTarget.style.background = '';
}

function agDrop(event, newStatus) {
  event.preventDefault();
  event.currentTarget.style.background = '';

  if (!draggedSvcId) return;

  const svc = Services.getServiceById(draggedSvcId);
  if (!svc) return;

  const oldStatus = svc.status || svc.st || 'agendado';
  if (oldStatus === newStatus) return;

  // Atualizar status
  Services.updateService(draggedSvcId, { status: newStatus });

  // Re-renderizar agenda
  renderAgenda();

  // Toast de confirmação
  const statusMeta = Services.getStatusMeta()[newStatus] || { label: newStatus };
  UI.showToast(`✅ Movido para "${statusMeta.label}"`, 'ok');

  // Atualizar badges se necessário
  UI.updateBadges(
    Services.getServicesByStatus('agendado').length,
    Services.getServicesByStatus('executado').length,
    0,
    0
  );
}

// ============================================
// INICIAR APP
// ============================================

UI.onDocumentReady(() => {
  init();
});
