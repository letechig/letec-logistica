// ============================================
// SERVICES.JS - Gerenciamento de dados
// ============================================

import { supabase } from './supabase.js';

// Estado global
let services = [];
let checkListRecords = [];
let currentMesFilter = 'all';
let currentPage = 'dashboard';

// ============================================
// CARREGAMENTO E SALVAMENTO LOCAL
// ============================================

export async function loadServicesFromSupabase() {
  try {
    const { getServices } = await import('./supabase.js');
    const supabaseServices = await getServices();
    
    if (supabaseServices && supabaseServices.length > 0) {
      // Normalizar campos do Supabase para o modelo interno
      services = supabaseServices.map(s => ({
        id: s.id,
        dt: s.data || s.dt,
        cliente: s.cliente || s.cl,
        endereco: s.endereco || '',
        horario: s.horario || s.hr || '',
        tipoServico: s.tiposervico || s.sc || '',
        tipos: Array.isArray(s.tipos) ? s.tipos : (s.tiposervico ? [s.tiposervico] : []),
        equipe: s.equipe || s.eq || '',
        veiculo: s.veiculo || '',
        OS: s.os || '',
        observacoes: s.observacoes || s.obs || '',
        status: s.status || s.st || 'agendado',
        ms: s.data ? s.data.substring(5, 7) : null
      }));
      
      console.log('✅ Serviços carregados do Supabase:', services.length);
      return true;
    } else {
      console.log('⚠️ Nenhum serviço encontrado no Supabase, usando localStorage');
      return false;
    }
  } catch (e) {
    console.error('❌ Erro ao carregar serviços do Supabase:', e);
    return false;
  }
}

export function loadState() {
  try {
    const saved = localStorage.getItem('letec_services');
    if (saved) {
      services = JSON.parse(saved);
      console.log('✅ Serviços carregados do localStorage:', services.length);
    }
  } catch (e) {
    console.error('❌ Erro ao carregar estado:', e);
    services = [];
  }
}

export function saveServices() {
  try {
    localStorage.setItem('letec_services', JSON.stringify(services));
    localStorage.setItem('letec_services_timestamp', new Date().toISOString());
    console.log('💾 Serviços salvos');
  } catch (e) {
    console.error('❌ Erro ao salvar serviços:', e);
  }
}

export function loadCheckListRecords() {
  try {
    const saved = localStorage.getItem('letec_checklists');
    if (saved) {
      checkListRecords = JSON.parse(saved);
      console.log('✅ Check Lists carregados:', checkListRecords.length);
    }
  } catch (e) {
    console.error('❌ Erro ao carregar checklists:', e);
    checkListRecords = [];
  }
}

export function saveCheckListRecords() {
  try {
    localStorage.setItem('letec_checklists', JSON.stringify(checkListRecords));
  } catch (e) {
    console.error('❌ Erro ao salvar checklists:', e);
  }
}

// ============================================
// ACESSO E FILTRAGEM
// ============================================

export function getServices() {
  return services;
}

export function setServices(newServices) {
  services = newServices;
  saveServices();
}

export function getCheckListRecords() {
  return checkListRecords;
}

export function addCheckListRecord(record) {
  checkListRecords.push(record);
  saveCheckListRecords();
}

export function getFilteredServices() {
  let filtered = [...services];

  if (currentMesFilter && currentMesFilter !== 'all') {
    filtered = filtered.filter(s => {
      const ms = s.ms || (s.dt ? s.dt.substring(5, 7) : '');
      return ms === currentMesFilter;
    });
  }

  return filtered;
}

export function setCurrentMonthFilter(mes) {
  currentMesFilter = mes;
}

export function getCurrentMonthFilter() {
  return currentMesFilter;
}

export function setCurrentPage(page) {
  currentPage = page;
}

export function getCurrentPage() {
  return currentPage;
}

// ============================================
// OPERAÇÕES CRUD
// ============================================

export async function addService(service) {
  if (!service.id) {
    service.id = Date.now();
  }
  services.push(service);
  saveServices();
  
  // Tentar salvar no Supabase
  try {
    const { saveServiceSupabase } = await import('./supabase.js');
    await saveServiceSupabase(service);
  } catch (e) {
    console.warn('⚠️ Não foi possível salvar no Supabase:', e);
  }
  
  return service;
}

export async function updateService(id, updates) {
  const index = services.findIndex(s => s.id === id);
  if (index !== -1) {
    services[index] = { ...services[index], ...updates };
    saveServices();
    
    // Tentar atualizar no Supabase
    try {
      const { updateServiceSupabase } = await import('./supabase.js');
      await updateServiceSupabase(services[index]);
    } catch (e) {
      console.warn('⚠️ Não foi possível atualizar no Supabase:', e);
    }
    
    return services[index];
  }
  return null;
}

export function deleteService(id) {
  services = services.filter(s => s.id !== id);
  saveServices();
}

export function getServiceById(id) {
  return services.find(s => s.id === id);
}

// ============================================
// UTILITÁRIOS
// ============================================

export function getMonthlySummary() {
  const summary = {};
  services.forEach(s => {
    const ms = s.ms || 'ALL';
    if (!summary[ms]) {
      summary[ms] = { total: 0, executado: 0, agendado: 0, reagendado: 0, cancelado: 0 };
    }
    summary[ms].total++;
    const st = (s.status || s.st || 'agendado').toLowerCase();
    if (st === 'executado') summary[ms].executado++;
    else if (st === 'agendado') summary[ms].agendado++;
    else if (st === 'reagendado') summary[ms].reagendado++;
    else if (st === 'cancelado') summary[ms].cancelado++;
  });
  return summary;
}

export function getServicesByStatus(status) {
  return services.filter(s => {
    const st = (s.status || s.st || 'agendado').toLowerCase();
    return st === status.toLowerCase();
  });
}

export function getServicesByTeam(team) {
  return services.filter(s => {
    const eq = s.equipe || s.eq || '';
    return eq.includes(team);
  });
}

export function getUniqueTeams() {
  const teams = new Set();
  services.forEach(s => {
    const eq = s.equipe || s.eq || '';
    if (eq) teams.add(eq);
  });
  return Array.from(teams).sort();
}

export function getUniqueClients() {
  const clients = new Set();
  services.forEach(s => {
    const cl = s.cliente || s.cl || '';
    if (cl) clients.add(cl);
  });
  return Array.from(clients).sort();
}

export function getUniqueServiceTypes() {
  const types = new Set();
  services.forEach(s => {
    const sc = s.tipoServico || s.sc || '';
    if (sc) types.add(sc);
  });
  return Array.from(types).sort();
}

export function sanitize(text) {
  const elem = document.createElement('div');
  elem.textContent = text;
  return elem.innerHTML;
}

export function getServiceTeam(service) {
  return service.equipe || service.eq || '';
}

export function calculateCapacity(services) {
  // Simplificação: assume 90min por serviço, jornada de 8h (480min)
  const tempoPorServico = 90;
  const jornadaTotal = 480;
  const usado = services.length * tempoPorServico;
  return { usado, total: jornadaTotal };
}

export function getTopTechnicians() {
  const teams = getUniqueTeams();
  return teams.map(team => {
    const teamServices = getServicesByTeam(team);
    const executed = teamServices.filter(s => (s.status || s.st) === 'executado').length;
    const total = teamServices.length;
    const tx = total > 0 ? Math.round(executed / total * 100) : 0;
    const media = teamServices.length > 0 ? +(teamServices.length / new Set(teamServices.map(s => s.dt)).size).toFixed(1) : 0;
    return { nome: team, total, tx, media };
  }).sort((a, b) => b.total - a.total);
}

export function getStatusMeta() {
  return {
    agendado: { label: 'Agendado', chip: 'chip-blue', color: 'var(--blue)' },
    executado: { label: 'Executado', chip: 'chip-green', color: 'var(--green)' },
    reagendado: { label: 'Reagendado', chip: 'chip-orange', color: 'var(--orange)' },
    cancelado: { label: 'Cancelado', chip: 'chip-red', color: 'var(--red)' }
  };
}

export function estimateDistance(addr1, addr2) {
  // Simplificação: assume 2km entre endereços diferentes
  return addr1 !== addr2 ? 2 : 0;
}

export function mesParaFiltro(service, mesFilt) {
  const dt = service.dt || '';
  if (!dt) return false;
  const mes = dt.substring(5, 7);
  return mes === mesFilt;
}

export function mesLabel(mes) {
  const labels = {
    '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
    '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
    '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro',
    'all': 'Ano inteiro'
  };
  return labels[mes] || mes;
}

export function extractServiceTypes(service) {
  const tipo = (service.tipoServico || service.sc || '').toUpperCase();
  return tipo.split(/[\s/,]/).filter(t => t.trim());
}

export function serviceFields(service) {
  return {
    cliente: service.cliente || service.cl || '—',
    endereco: service.endereco || '—',
    horario: service.horario || service.hr || '—',
    equipe: service.equipe || service.eq || '—',
    veiculo: service.veiculo || service.vc || '—',
    tipoRaw: service.tipoServico || service.sc || '',
    status: service.status || service.st || 'agendado'
  };
}

export function tipoChipsHtml(service, options = {}) {
  const tipos = extractServiceTypes(service);
  const { compact = false, fontSize = '10px' } = options;

  if (!tipos.length) return '';

  return tipos.map(tipo => {
    const meta = getTipoMeta()[tipo] || { cor: '#94a3b8', label: tipo };
    const style = compact
      ? `font-size:${fontSize};padding:1px 4px;border-radius:3px;background:${meta.cor}20;color:${meta.cor};font-weight:600;margin-right:2px`
      : `font-size:10px;padding:2px 6px;border-radius:4px;background:${meta.cor}20;color:${meta.cor};font-weight:600;margin-right:3px`;
    return `<span style="${style}">${meta.label}</span>`;
  }).join('');
}

export function getTipoMeta() {
  return {
    'INST': { cor: '#2563eb', label: 'Instalação' },
    'MAN': { cor: '#16a34a', label: 'Manutenção' },
    'REP': { cor: '#ea580c', label: 'Reparo' },
    'VIS': { cor: '#7c3aed', label: 'Visita' },
    'SUP': { cor: '#0891b2', label: 'Suporte' },
    'OUTRO': { cor: '#94a3b8', label: 'Outro' }
  };
}

export function jsArg(value) {
  return JSON.stringify(value);
}

export function escapeHtmlAttr(value) {
  return String(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
