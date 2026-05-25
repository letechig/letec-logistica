// Tipos de serviço (referência de labels/cores, sem lógica de negócio acoplada).
var TIPO_SERVICO = {
  DS:       { label: 'Desinsetização',        cor: '#16a34a' },
  DR:       { label: 'Desratização',          cor: '#2563eb' },
  LCA:      { label: 'Higienização Cx Água',  cor: '#0891b2' },
  DST:      { label: 'Desentupimento',        cor: '#dc2626' },
  DSC:      { label: 'Descupinização',        cor: '#7c3aed' },
  MON:      { label: 'Monitoramento',         cor: '#ea580c' },
  ISCA:     { label: 'Iscagem',               cor: '#b45309' },
  HIG:      { label: 'Higienização Estofado', cor: '#0891b2' },
  TERMO:    { label: 'Termo/Laudo',           cor: '#475569' },
  VIS:      { label: 'Vistoria',              cor: '#0f766e' },
  REU:      { label: 'Reunião',               cor: '#6d28d9' },
  VISTEC:   { label: 'Visita Técnica',        cor: '#0369a1' },
  MAN:      { label: 'Manobra',               cor: '#92400e' },
  OUTRO:    { label: 'Outro',                 cor: '#94a3b8' },
};

// Catálogo ordenado para selects/checkboxes — fonte única de verdade.
var TIPOS_CATALOGO = [
  { key:'DS',     grupo:'Pragas',      label:'DS — Desinsetização'       },
  { key:'DR',     grupo:'Pragas',      label:'DR — Desratização'         },
  { key:'DSC',    grupo:'Pragas',      label:'DSC — Descupinização'      },
  { key:'ISCA',   grupo:'Pragas',      label:'ISCA — Iscagem'            },
  { key:'MON',    grupo:'Pragas',      label:'MON — Monitoramento'       },
  { key:'LCA',    grupo:'Infraestrutura', label:'LCA — Cx d\'Água'      },
  { key:'DST',    grupo:'Infraestrutura', label:'DST — Desentupimento'  },
  { key:'HIG',    grupo:'Infraestrutura', label:'HIG — Higienização Est.'},
  { key:'TERMO',  grupo:'Documentação', label:'TERMO — Termo/Laudo'     },
  { key:'VIS',    grupo:'Operacional', label:'VIS — Vistoria'           },
  { key:'REU',    grupo:'Operacional', label:'REU — Reunião'            },
  { key:'VISTEC', grupo:'Operacional', label:'VISTEC — Visita Técnica'  },
  { key:'MAN',    grupo:'Operacional', label:'MAN — Manobra'            },
  { key:'OUTRO',  grupo:'Operacional', label:'Outro'                    },
];

window.TIPO_SERVICO = TIPO_SERVICO;
window.TIPOS_CATALOGO = TIPOS_CATALOGO;
