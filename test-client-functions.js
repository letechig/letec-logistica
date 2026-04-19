// Script de teste das funcionalidades do módulo cliente
// Execute este código no console do navegador (F12) na página http://localhost:8000

console.log('🧪 Iniciando testes do módulo cliente...');

// Teste 1: Verificar se os campos existem
console.log('1️⃣ Verificando campos do formulário...');
const cepField = document.getElementById('cli-form-cep');
const urgenciaField = document.getElementById('cli-form-urgencia');
const historicoSection = document.getElementById('cli-historico-section');

console.log('Campo CEP:', cepField ? '✅ Existe' : '❌ Não encontrado');
console.log('Campo Urgência:', urgenciaField ? '✅ Existe' : '❌ Não encontrado');
console.log('Seção Histórico:', historicoSection ? '✅ Existe' : '❌ Não encontrado');

// Teste 2: Verificar se as funções existem
console.log('2️⃣ Verificando funções...');
console.log('buscarCepCliente:', typeof buscarCepCliente === 'function' ? '✅ Existe' : '❌ Não encontrada');
console.log('verificarDuplicatasCliente:', typeof verificarDuplicatasCliente === 'function' ? '✅ Existe' : '❌ Não encontrada');
console.log('loadClientHistory:', typeof loadClientHistory === 'function' ? '✅ Existe' : '❌ Não encontrada');
console.log('openServiceFromClient:', typeof openServiceFromClient === 'function' ? '✅ Existe' : '❌ Não encontrada');

// Teste 3: Verificar se o botão de quick action existe
console.log('3️⃣ Verificando botão de quick action...');
const quickActionButtons = document.querySelectorAll('button[title*="Criar serviço"]');
console.log('Botões de quick action encontrados:', quickActionButtons.length);

// Teste 4: Simular abertura do modal cliente
console.log('4️⃣ Testando abertura do modal cliente...');
if (typeof openClientModal === 'function') {
    console.log('✅ Função openClientModal existe');
} else {
    console.log('❌ Função openClientModal não encontrada');
}

console.log('🎯 Testes concluídos! Verifique os resultados acima.');