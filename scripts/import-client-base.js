const path = require('path');
const readXlsxFile = require('read-excel-file/node');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const DEFAULT_WORKBOOK = path.resolve(__dirname, '..', '..', 'BASE_CLIENTES_TRATADA_LETEC (1).xlsx');
const workbookPath = path.resolve(process.argv.find(arg => arg.endsWith('.xlsx')) || DEFAULT_WORKBOOK);
const apply = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const EVENTUAL_RECENT_YEARS = new Set([2025, 2026]);
const EXPECTED_SHEETS = ['CONTRATOS', 'EVENTUAIS', 'REVISAR'];

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeLoose(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return normalizeLoose(value)
    .replace(/\b(LTDA|EIRELI|MEI|ME|EPP|S\/?A|SA)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAddress(value) {
  return normalizeLoose(value)
    .replace(/\bAVENIDA\b/g, 'AV')
    .replace(/\bRUA\b/g, 'R')
    .replace(/\bESTRADA\b/g, 'EST')
    .replace(/\bDOUTOR\b/g, 'DR')
    .replace(/\bCONDOMINIO\b/g, 'COND')
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getYear(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

function importKey(row) {
  const doc = onlyDigits(row.cnpjcpf);
  const address = normalizeAddress(row.endereco);
  const name = normalizeName(row.nome_id || row.cliente_oficial);
  if (doc && address) return `doc:${doc}|${address}`;
  return `name:${name}|${address}`;
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] === undefined ? null : row[index];
    return acc;
  }, {});
}

async function readSheet(filePath, sheetName) {
  const sheetResults = await readXlsxFile(filePath, { sheets: [sheetName] });
  const rows = sheetResults[0]?.data || [];
  const headers = (rows.shift() || []).map(header => clean(header));
  return rows
    .map(row => rowToObject(headers, row))
    .filter(row => Object.values(row).some(value => value !== null && value !== ''));
}

function mapPeriodicidade(value) {
  const text = normalizeLoose(value);
  if (!text) return null;
  if (text.includes('SEMANAL')) return 'semanal';
  if (text.includes('QUINZENAL')) return 'quinzenal';
  if (text.includes('BIMESTRAL')) return 'bimestral';
  if (text.includes('TRIMESTRAL')) return 'trimestral';
  if (text.includes('SEMESTRAL')) return 'semestral';
  if (text.includes('MENSAL')) return 'mensal';
  if (text.includes('ANUAL') || text.includes('RENOVACAO')) return 'anual';
  return null;
}

function mapContractStatus(value) {
  const status = clean(value) || 'Revisar';
  if (status.toLowerCase() === 'sem contrato') return 'Revisar';
  return status;
}

function mapEventualStatus(row) {
  const year = getYear(row.ultima_execucao_identificada);
  if (year === 2026) return 'Eventual recente';
  if (year === 2025) return 'Eventual antigo';
  return 'Historico/Inativo';
}

function shouldBeActive(row, source) {
  if (source === 'CONTRATOS') {
    const status = normalizeLoose(row.status_operacional);
    return status === 'ATIVO' || status === 'A RENOVAR';
  }
  const year = getYear(row.ultima_execucao_identificada);
  return EVENTUAL_RECENT_YEARS.has(year);
}

function customerPayload(row, source) {
  const isContract = source === 'CONTRATOS';
  const statusOperacional = isContract ? mapContractStatus(row.status_operacional) : mapEventualStatus(row);
  const categoria = isContract ? 'contrato' : 'eventual';
  const periodicidade = isContract ? mapPeriodicidade(row.periodicidade_indicada) : null;
  const prioridade = isContract && ['Ativo', 'A renovar'].includes(statusOperacional)
    ? 'Alta'
    : (clean(row.prioridade_sugerida) || (isContract ? 'Alta' : 'Media'));

  return {
    nome: clean(row.cliente_oficial) || clean(row.nome_id),
    nome_normalizado: normalizeName(row.nome_id || row.cliente_oficial),
    telefone: onlyDigits(row.telefone) || null,
    endereco: clean(row.endereco),
    endereco_completo: clean(row.endereco),
    bairro: null,
    cidade: clean(row.cidade),
    categoria,
    tipo: onlyDigits(row.cnpjcpf).length > 11 ? 'PJ' : 'PF',
    cpf_cnpj: onlyDigits(row.cnpjcpf) || null,
    contato: clean(row.contato),
    zona: clean(row.zona_sugerida),
    tipo_cliente: isContract ? 'Contrato' : 'Eventual',
    status_operacional: statusOperacional,
    prioridade,
    origem: [clean(row.origem_cadastro), clean(row.origem_agenda)].filter(Boolean).join(', ') || source,
    cliente_recorrente: isContract,
    periodicidade,
    data_ultimo_servico: dateOnly(row.ultima_execucao_identificada),
    observacoes: [
      clean(row.observacao_revisao),
      clean(row.match_confianca) ? `Confianca do cruzamento: ${clean(row.match_confianca)}` : null
    ].filter(Boolean).join('\n') || null,
    ativo: shouldBeActive(row, source)
  };
}

function contractPayload(row, customerId) {
  return {
    customer_id: customerId,
    numero_contrato: clean(row.proposta),
    data_inicio: null,
    data_vencimento: dateOnly(row.vencimento_contrato),
    periodicidade: mapPeriodicidade(row.periodicidade_indicada),
    tipo_servico: clean(row.servicos_identificados),
    valor: null,
    status_contrato: mapContractStatus(row.status_operacional),
    proxima_execucao_sugerida: null,
    observacoes: [clean(row.meses_marcados), clean(row.observacao_revisao)].filter(Boolean).join(' | ') || null,
    origem: [clean(row.origem_cadastro), clean(row.origem_agenda)].filter(Boolean).join(', ') || 'CONTRATOS'
  };
}

function historyPayload(row, customerId, source) {
  return {
    customer_id: customerId,
    data_atendimento: dateOnly(row.ultima_execucao_identificada),
    origem: [source, clean(row.origem_cadastro), clean(row.origem_agenda)].filter(Boolean).join(', '),
    servico: clean(row.servicos_identificados),
    tecnico: null,
    observacoes: clean(row.observacao_revisao)
  };
}

function reviewPayload(row, tipoProblema, descricao, sugestao, customerId = null) {
  return {
    customer_id: customerId,
    tipo_problema: tipoProblema,
    descricao,
    sugestao,
    status_revisao: 'pendente',
    origem: [clean(row.origem_cadastro), clean(row.origem_agenda)].filter(Boolean).join(', ') || null,
    payload: {
      cliente: clean(row.cliente_oficial),
      endereco: clean(row.endereco),
      telefone: clean(row.telefone),
      cnpjcpf: clean(row.cnpjcpf),
      proposta: clean(row.proposta),
      match_confianca: clean(row.match_confianca),
      contrato_match_nome: clean(row.contrato_match_nome)
    }
  };
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizeName(left).split(' ').filter(token => token.length > 2));
  const b = new Set(normalizeName(right).split(' ').filter(token => token.length > 2));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(token => b.has(token)).length;
  return shared / Math.max(a.size, b.size);
}

async function fetchExistingCustomers() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('customers')
    .select('*');
  if (error) throw error;
  return data || [];
}

function existingKey(customer) {
  const doc = onlyDigits(customer.cpf_cnpj);
  const address = normalizeAddress(customer.endereco_completo || customer.endereco || [customer.rua, customer.numero, customer.bairro, customer.cidade].filter(Boolean).join(' '));
  const name = normalizeName(customer.nome_normalizado || customer.nome);
  if (doc && address) return `doc:${doc}|${address}`;
  return `name:${name}|${address}`;
}

async function insertOne(table, payload) {
  const { data, error } = await supabase.from(table).insert([payload]).select();
  if (error) throw error;
  return data[0];
}

async function main() {
  const rows = {
    CONTRATOS: await readSheet(workbookPath, 'CONTRATOS'),
    EVENTUAIS: await readSheet(workbookPath, 'EVENTUAIS'),
    REVISAR: await readSheet(workbookPath, 'REVISAR')
  };

  if (apply && !supabase) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY sao obrigatorios para --apply');
  }

  const existingCustomers = await fetchExistingCustomers();
  const existingByKey = new Map(existingCustomers.map(customer => [existingKey(customer), customer]));
  const importedByKey = new Map();
  const counters = {
    sheets: Object.fromEntries(Object.entries(rows).map(([sheet, sheetRows]) => [sheet, sheetRows.length])),
    customersToCreate: 0,
    customersCreated: 0,
    contractsToCreate: 0,
    contractsCreated: 0,
    historyToCreate: 0,
    historyCreated: 0,
    reviewsToCreate: 0,
    reviewsCreated: 0,
    existingConflicts: 0,
    duplicateKeysSkipped: 0
  };

  async function createReview(row, tipo, descricao, sugestao, customerId = null) {
    counters.reviewsToCreate += 1;
    if (!apply) return;
    await insertOne('data_reviews', reviewPayload(row, tipo, descricao, sugestao, customerId));
    counters.reviewsCreated += 1;
  }

  async function processRow(row, source) {
    const key = importKey(row);
    const payload = customerPayload(row, source);
    if (!payload.nome) return;

    const existing = existingByKey.get(key);
    if (existing) {
      counters.existingConflicts += 1;
      await createReview(
        row,
        'possivel_cliente_existente',
        `Registro da planilha parece corresponder ao cliente existente "${existing.nome}".`,
        'Conferir manualmente se deve complementar o cadastro existente, manter separado como unidade/filial ou ignorar.',
        existing.id
      );
      return;
    }

    let customer = importedByKey.get(key);
    if (!customer) {
      counters.customersToCreate += 1;
      if (apply) customer = await insertOne('customers', payload);
      else customer = { id: null, ...payload };
      importedByKey.set(key, customer);
      if (apply) counters.customersCreated += 1;
    } else {
      counters.duplicateKeysSkipped += 1;
    }

    const customerId = customer.id || null;
    if (source === 'CONTRATOS') {
      counters.contractsToCreate += 1;
      if (apply) {
        await insertOne('contracts', contractPayload(row, customerId));
        counters.contractsCreated += 1;
      }
    }

    if (source !== 'CONTRATOS' || row.ultima_execucao_identificada) {
      counters.historyToCreate += 1;
      if (apply) {
        await insertOne('customer_service_history', historyPayload(row, customerId, source));
        counters.historyCreated += 1;
      }
    }

    if (!row.endereco) {
      await createReview(row, 'endereco_ausente', `Cliente "${payload.nome}" sem endereco.`, 'Completar endereco antes de roteirizar.', customerId);
    }
    if (!row.telefone) {
      await createReview(row, 'telefone_ausente', `Cliente "${payload.nome}" sem telefone.`, 'Completar telefone ou confirmar que o contato nao existe.', customerId);
    }
    if (!payload.tipo_cliente) {
      await createReview(row, 'cliente_sem_classificacao', `Cliente "${payload.nome}" sem classificacao.`, 'Definir se e contrato, eventual ou historico.', customerId);
    }
    if (source === 'CONTRATOS' && !row.vencimento_contrato) {
      await createReview(row, 'contrato_sem_vencimento', `Contrato de "${payload.nome}" sem vencimento.`, 'Informar vencimento do contrato.', customerId);
    }
    if (source === 'CONTRATOS' && !row.periodicidade_indicada) {
      await createReview(row, 'contrato_sem_periodicidade', `Contrato de "${payload.nome}" sem periodicidade.`, 'Informar periodicidade operacional.', customerId);
    }
    if (row.observacao_revisao) {
      await createReview(row, 'possivel_duplicidade', clean(row.observacao_revisao), 'Conferir manualmente antes de mesclar ou alterar cadastro.', customerId);
    }
  }

  for (const row of rows.CONTRATOS) await processRow(row, 'CONTRATOS');

  for (const row of rows.EVENTUAIS) {
    await processRow(row, 'EVENTUAIS');
  }

  for (const row of rows.REVISAR) {
    counters.reviewsToCreate += 1;
    if (apply) {
      await insertOne('data_reviews', reviewPayload(
        row,
        row.contrato_match_nome ? 'nome_parecido' : 'possivel_duplicidade',
        clean(row.observacao_revisao) || `Registro de "${clean(row.cliente_oficial)}" precisa de revisao.`,
        'Conferir manualmente antes de alterar, unir ou descartar.'
      ));
      counters.reviewsCreated += 1;
    }
  }

  const imported = [...importedByKey.values()];
  for (let i = 0; i < imported.length; i += 1) {
    for (let j = i + 1; j < imported.length; j += 1) {
      const left = imported[i];
      const right = imported[j];
      const sameAddress = normalizeAddress(left.endereco) && normalizeAddress(left.endereco) === normalizeAddress(right.endereco);
      if (sameAddress && tokenSimilarity(left.nome, right.nome) >= 0.6 && normalizeName(left.nome) !== normalizeName(right.nome)) {
        counters.reviewsToCreate += 1;
        if (apply) {
          await insertOne('data_reviews', {
            customer_id: left.id || null,
            tipo_problema: 'nome_parecido',
            descricao: `"${left.nome}" e "${right.nome}" tem nomes parecidos no mesmo endereco.`,
            sugestao: 'Conferir manualmente se sao duplicados ou cadastros distintos.',
            status_revisao: 'pendente',
            origem: 'Importacao BASE_CLIENTES_TRATADA_LETEC',
            payload: { left_customer_id: left.id, right_customer_id: right.id, endereco: left.endereco }
          });
          counters.reviewsCreated += 1;
        }
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    workbook: workbookPath,
    sheetsRead: EXPECTED_SHEETS,
    counters
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
