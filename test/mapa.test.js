// "Gerar mapa de agentes": casamento telefonia -> helpdesk e lista de excluídos.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { carregarWorkflow, rodarCode } = require('../sandbox/n8n');

const { nos } = carregarWorkflow('gerar-mapa-de-agentes.json');

const TELEFONIA = [
  { data: [
    { id: 10, name: 'Ana Souza', email: 'Ana.Souza@Exemplo.com', login: 'ana', queues: [4] },
    { id: 11, name: 'Bruno Lima', email: '', login: 'bruno.lima', queues: [4] },
    { id: 12, name: 'João da Silva', email: '', login: 'joao', queues: [4] },
    { id: 13, name: 'Carla Dias', email: 'carla@exemplo.com', login: 'carla', queues: [4], archived: true },
  ] },
  { data: [
    { id: 53, name: 'Diego Nunes', email: 'diego@exemplo.com', login: 'diego', queues: [87] },
    { id: 54, name: 'Elisa Gomes', email: 'elisa@exemplo.com', login: 'elisa', queues: ['87', '4'] },
    { id: 55, name: 'Fábio Reis', email: 'fabio@exemplo.com', login: 'fabio', queues: [4] },
  ] },
  { data: [] },
];

const HELPDESK = [[
  { id: 700, email: 'ana.souza@exemplo.com', username: 'asouza', fullname: 'Ana Souza', status_id: 2, teams: { 1: 'Atendimento' } },
  { id: 704, email: '', username: 'Bruno.Lima', fullname: 'Bruno L.', status_id: 2, teams: { 10: 'Retenção' } },
  { id: 705, email: '', username: 'jsilva', fullname: 'Joao  da  Silva', status_id: 2, teams: { 1: 'Atendimento' } },
  { id: 800, email: 'diego@exemplo.com', username: 'diego', fullname: 'Diego Nunes', status_id: 2, teams: { 3: 'Cobrança' } },
  { id: 801, email: 'elisa@exemplo.com', username: 'elisa', fullname: 'Elisa Gomes', status_id: 2, teams: {} },
  { id: 900, email: 'fabio@exemplo.com', username: 'fabio', fullname: 'Fábio Reis', status_id: 3, teams: { 1: 'Atendimento' } },
]];

const [saida] = rodarCode(nos['Monta Mapa'], { saidas: { 'Agentes Telefonia': TELEFONIA, 'Agentes Helpdesk': HELPDESK } });

test('casa por e-mail sem diferenciar maiúsculas', () => {
  assert.deepEqual(saida.mapaAgentes['10'], { r: '700', t: '1' });
});

test('casa por login quando não há e-mail', () => {
  assert.deepEqual(saida.mapaAgentes['11'], { r: '704', t: '10' });
});

test('casa por nome ignorando acento, espaço e caixa', () => {
  assert.deepEqual(saida.mapaAgentes['12'], { r: '705', t: '1' });
});

test('lê todas as páginas da telefonia', () => {
  assert.ok(saida.mapaAgentes['53'], 'agente da 2ª página ficou de fora');
});

test('ignora agente arquivado e agente inativo no helpdesk', () => {
  assert.equal(saida.mapaAgentes['13'], undefined);
  assert.equal(saida.mapaAgentes['55'], undefined);
  assert.deepEqual(saida.sem_match, [{ id: 55, nome: 'Fábio Reis' }]);
});

test('agente sem equipe entra com t vazio (o fluxo principal não atribui a ele)', () => {
  assert.deepEqual(saida.mapaAgentes['54'], { r: '801', t: '' });
});

test('excluídos = agentes da fila configurada, em qualquer página', () => {
  assert.deepEqual(saida.agentesExcluidos, ['53', '54']);
});
