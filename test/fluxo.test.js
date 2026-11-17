// Cenários de ponta a ponta do fluxo principal, com o código real dos nós do workflow.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { carregarWorkflow, exemplo, criarRelogio, rodarCode, avaliarFiltro } = require('../sandbox/n8n');

const PERNA_1 = exemplo('webhook-perna-1.json');        // agente 10 atende e transfere
const PERNA_2 = exemplo('webhook-perna-2.json');        // agente 11 recebe a transferência
const COBRANCA = exemplo('webhook-cobranca.json');      // agente 53 (excluído) atende e transfere
const INGRESSO = exemplo('webhook-ingresso-ura.json');  // entrada na URA, ainda sem agente
const COM_CPF = exemplo('dados-chamada.json');
const SEM_CPF = { data: JSON.stringify({ call_info: [] }) };

// --------------------------------------------------------------------------- simulação
function ambiente() {
  const { nos } = carregarWorkflow('protocolo-por-ligacao.json');
  return { nos, relogio: criarRelogio(), estado: {}, tickets: [] };
}

function rodar(amb, nome, json, saidas) {
  return rodarCode(amb.nos[nome], { json, saidas, estado: amb.estado, relogio: amb.relogio })[0];
}

// Anti-duplicado → Resolve Agente → Ação?
function decidir(amb, item, saidas) {
  const anti = rodar(amb, 'Anti-duplicado', item, saidas);
  const resolvido = rodar(amb, 'Resolve Agente', anti, saidas);
  return { acao: resolvido.acao, item: resolvido, saidas: { ...saidas, 'Resolve Agente': resolvido } };
}

// Webhook → Config → Só Atendidas → Busca Dados da Chamada → Prepara Chamada → Gera Protocolo? → decidir
function chegada(amb, evento, dadosChamada) {
  const config = rodar(amb, 'Config', { headers: {}, params: {}, query: {}, body: evento }, {});
  const saidas = { Config: config };
  if (!avaliarFiltro(amb.nos['Só Atendidas'], config)) return { filtrado: 'Só Atendidas' };
  const prep = rodar(amb, 'Prepara Chamada', dadosChamada, saidas);
  saidas['Prepara Chamada'] = prep;
  if (!avaliarFiltro(amb.nos['Gera Protocolo?'], prep)) return { filtrado: 'Gera Protocolo?', prep };
  return { ...decidir(amb, prep, saidas), prep };
}

// Aguarda Ticket (espera) → volta ao Anti-duplicado
function aguardar(amb, perna) {
  amb.relogio.avancar(perna.saidas.Config.config.esperaSeg * 1000);
  return decidir(amb, perna.item, perna.saidas);
}

// Busca/Cria Contato → Cria Ticket → Registra Ticket
function criarTicket(amb, perna) {
  const ticket = { id: String(1000 + amb.tickets.length), responsible_id: perna.item.responsible_id, team_id: perna.item.team_id };
  amb.tickets.push(ticket);
  rodar(amb, 'Registra Ticket', ticket, perna.saidas);
  return ticket;
}

// Atualiza Ticket (PUT)
function atualizarTicket(amb, perna) {
  const ticket = amb.tickets.find((t) => t.id === perna.item.ticket_id);
  assert.ok(ticket, `ticket ${perna.item.ticket_id} não existe`);
  Object.assign(ticket, { responsible_id: perna.item.responsible_id, team_id: perna.item.team_id });
}

const minutos = (n) => n * 60 * 1000;

// --------------------------------------------------------------------------- cenários
test('ligação direta: um protocolo com o agente que atendeu', () => {
  const amb = ambiente();
  const perna = chegada(amb, PERNA_1, COM_CPF);
  assert.equal(perna.acao, 'criar');
  assert.equal(perna.prep.cpf, '12345678909');
  assert.equal(perna.prep.empresa, 'SEGUROS');
  criarTicket(amb, perna);
  assert.deepEqual(amb.tickets, [{ id: '1000', responsible_id: '700', team_id: '1' }]);
});

test('transferência assistida: a 2ª perna espera o ticket e passa o protocolo para quem recebeu', () => {
  const amb = ambiente();
  const p1 = chegada(amb, PERNA_1, COM_CPF);
  assert.equal(p1.acao, 'criar');

  amb.relogio.avancar(1000);                       // 2ª perna chega antes de o ticket existir
  let p2 = chegada(amb, PERNA_2, SEM_CPF);
  assert.equal(p2.acao, 'aguardar');
  assert.equal(p2.prep.cpf, '12345678909', 'CPF recuperado pelo telefone de quem ligou');

  amb.relogio.avancar(1000);
  const ticket = criarTicket(amb, p1);

  p2 = aguardar(amb, p2);
  assert.equal(p2.acao, 'atualizar');
  assert.equal(p2.item.ticket_id, ticket.id);
  atualizarTicket(amb, p2);

  assert.equal(amb.tickets.length, 1);
  assert.deepEqual(amb.tickets[0], { id: ticket.id, responsible_id: '704', team_id: '10' });
});

test('cobrança transfere para o atendimento: só a perna do atendimento gera protocolo', () => {
  const amb = ambiente();
  const c = chegada(amb, COBRANCA, COM_CPF);
  assert.equal(c.filtrado, 'Gera Protocolo?');
  assert.equal(c.prep.excluido, true);

  amb.relogio.avancar(1000);
  const p2 = chegada(amb, PERNA_2, SEM_CPF);
  assert.equal(p2.acao, 'criar');
  criarTicket(amb, p2);
  assert.deepEqual(amb.tickets.map((t) => t.responsible_id), ['704']);
});

test('entrada na URA ainda sem agente (agent_id "None") não gera nada', () => {
  assert.equal(chegada(ambiente(), INGRESSO, COM_CPF).filtrado, 'Só Atendidas');
});

test('sem CPF digitado e sem histórico do telefone: não gera protocolo', () => {
  const r = chegada(ambiente(), PERNA_1, SEM_CPF);
  assert.equal(r.filtrado, 'Gera Protocolo?');
  assert.equal(r.prep.cpf_valido, false);
});

test('agente fora do mapa na 2ª perna: ignora em vez de apagar o responsável', () => {
  const amb = ambiente();
  const p1 = chegada(amb, PERNA_1, COM_CPF);
  criarTicket(amb, p1);
  amb.relogio.avancar(2000);
  const p2 = chegada(amb, { ...PERNA_2, agent_id: '99' }, SEM_CPF);
  assert.equal(p2.acao, 'ignorar');
  assert.equal(amb.tickets[0].responsible_id, '700');
});

test('perna anterior falhou antes de criar: passado o limite da reserva, a seguinte cria', () => {
  const amb = ambiente();
  assert.equal(chegada(amb, PERNA_1, COM_CPF).acao, 'criar');   // nunca registra o ticket
  amb.relogio.avancar(61 * 1000);
  assert.equal(chegada(amb, PERNA_2, SEM_CPF).acao, 'criar');
});

test('espera esgotada: depois das tentativas configuradas, cria assim mesmo', () => {
  const amb = ambiente();
  chegada(amb, PERNA_1, COM_CPF);                                // reserva e não conclui
  amb.relogio.avancar(1000);
  let p2 = chegada(amb, PERNA_2, SEM_CPF);
  let esperas = 0;
  while (p2.acao === 'aguardar') {
    p2 = aguardar(amb, p2);
    esperas += 1;
    assert.ok(esperas <= 10, 'loop sem fim');
  }
  assert.equal(p2.acao, 'criar');
  assert.equal(esperas, p2.saidas.Config.config.tentativasMax);
});

test('nova ligação do mesmo número depois da janela gera outro protocolo', () => {
  const amb = ambiente();
  criarTicket(amb, chegada(amb, PERNA_1, COM_CPF));
  amb.relogio.avancar(minutos(31));
  const nova = chegada(amb, PERNA_2, COM_CPF);
  assert.equal(nova.acao, 'criar');
});

test('Resolve Agente só deixa passar ids numéricos (o helpdesk cria equipe a partir de texto)', () => {
  const amb = ambiente();
  const saidas = { Config: { config: { mapaAgentes: { 10: { r: 'Fulano', t: '<T>' }, 11: { r: '704', t: '' } } } } };
  const texto = rodar(amb, 'Resolve Agente', { agente: '10', acao: 'criar' }, saidas);
  assert.deepEqual([texto.responsible_id, texto.team_id, texto.acao], ['', '', 'criar']);
  const semEquipe = rodar(amb, 'Resolve Agente', { agente: '11', acao: 'atualizar' }, saidas);
  assert.deepEqual([semEquipe.responsible_id, semEquipe.acao], ['', 'ignorar']);
});
