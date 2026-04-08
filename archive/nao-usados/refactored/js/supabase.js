// ============================================
// SUPABASE.JS - Configuração e conexão
// ============================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://zqrztixmrpnpehppylyr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TwfVUWjr87_VdHFzJURGmw_KVmXCiBq';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USAR_SUPABASE = true;

// ============================================
// CARREGAMENTO DE CATÁLOGOS
// ============================================

let _technicians = [];
let _serviceTypes = [];
let _catalogLoadPromise = null;

export async function loadTechnicians() {
  try {
    const { data, error } = await supabase
      .from('technicians')
      .select('id, nome')
      .eq('ativo', true)
      .order('nome');

    if (error) throw error;
    _technicians = data || [];
    console.log('✅ Técnicos carregados:', _technicians.length);
    return _technicians;
  } catch (e) {
    console.error('❌ Erro ao carregar técnicos:', e);
    _technicians = [];
    return [];
  }
}

export async function loadServiceTypes() {
  try {
    const { data, error } = await supabase
      .from('service_types')
      .select('*')
      .order('nome');

    if (error) throw error;
    _serviceTypes = data || [];
    console.log('✅ Tipos de serviço carregados:', _serviceTypes.length);
    return _serviceTypes;
  } catch (e) {
    console.error('❌ Erro ao carregar tipos:', e);
    _serviceTypes = [];
    return [];
  }
}

export function loadCatalogs() {
  if (!_catalogLoadPromise) {
    _catalogLoadPromise = Promise.all([
      loadTechnicians(),
      loadServiceTypes()
    ]);
  }
  return _catalogLoadPromise;
}

export function getTechnicians() {
  return _technicians;
}

export function getServiceTypes() {
  return _serviceTypes;
}

// ============================================
// PREPARAÇÃO PARA SUPABASE
// ============================================

export function prepareForSupabase(service) {
  return {
    id: service.id,
    date: service.data || service.dt || null,
    cliente: service.cliente || service.cl || '',
    endereco: service.endereco || '',
    horario: service.horario || service.hr || '',
    tiposervico: service.tipoServico || service.sc || '',
    tipos: Array.isArray(service.tipos) ? service.tipos : (service.tipoServico ? [service.tipoServico] : []),
    equipe: service.equipe || service.eq || '',
    veiculo: service.veiculo || '',
    os: service.OS || service.os || '',
    observacoes: service.observacoes || service.obs || '',
    status: service.status || service.st || 'agendado',
  };
}

export function cloneServiceState(service) {
  if (!service) return null;
  return {
    ...service,
    tipos: Array.isArray(service.tipos) ? [...service.tipos] : [],
    tecnicos_ids: Array.isArray(service.tecnicos_ids) ? [...service.tecnicos_ids] : [],
  };
}

// ============================================
// OPERAÇÕES SUPABASE
// ============================================

export async function testSupabase() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .limit(1);

    if (error) throw error;
    console.log('✅ Supabase conectado!', data);
    return true;
  } catch (e) {
    console.error('❌ Erro Supabase:', e.message);
    return false;
  }
}

export async function saveServiceSupabase(service) {
  try {
    const prepared = prepareForSupabase(service);

    const { data, error } = await supabase
      .from('services')
      .insert([prepared]);

    if (error) throw error;
    console.log('✅ Serviço salvo no Supabase');
    return { data, error: null };
  } catch (e) {
    console.error('❌ Erro ao salvar serviço:', e);
    return { data: null, error: e };
  }
}

export async function updateServiceSupabase(service) {
  try {
    const prepared = prepareForSupabase(service);

    const { data, error } = await supabase
      .from('services')
      .upsert([prepared], { onConflict: 'id' });

    if (error) throw error;
    console.log('✅ Serviço atualizado no Supabase');
    return { data, error: null };
  } catch (e) {
    console.error('❌ Erro ao atualizar serviço:', e);
    return { data: null, error: e };
  }
}

export async function getServices() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .order('data', { ascending: false });

    if (error) {
      // Se a tabela não existe, tentar criar
      if (error.code === 'PGRST116') {
        console.log('📋 Tabela services não encontrada, tentando criar...');
        await createServicesTable();
        return [];
      }
      throw error;
    }
    return data || [];
  } catch (e) {
    console.error('❌ Erro ao buscar serviços:', e);
    return [];
  }
}

export async function createServicesTable() {
  try {
    // Criar tabela services via SQL
    const { error } = await supabase.rpc('create_services_table');
    
    if (error) {
      console.warn('⚠️ Não foi possível criar tabela automaticamente:', error);
      console.log('💡 Você pode criar a tabela manualmente no Supabase com:');
      console.log(`
CREATE TABLE services (
  id BIGINT PRIMARY KEY,
  data DATE,
  cliente TEXT,
  endereco TEXT,
  horario TEXT,
  tiposervico TEXT,
  tipos TEXT[],
  equipe TEXT,
  veiculo TEXT,
  os TEXT,
  observacoes TEXT,
  status TEXT DEFAULT 'agendado'
);
      `);
    } else {
      console.log('✅ Tabela services criada com sucesso!');
    }
  } catch (e) {
    console.warn('⚠️ Erro ao criar tabela:', e);
  }
}

export function useSupabase() {
  return USAR_SUPABASE;
}