// Checagens do JSON dos workflows: ligações válidas, referências existentes e nada sensível.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { carregarWorkflow } = require('../sandbox/n8n');

const ARQUIVOS = ['protocolo-por-ligacao.json', 'gerar-mapa-de-agentes.json'];

for (const arquivo of ARQUIVOS) {
  const { wf, nos } = carregarWorkflow(arquivo);

  test(`${arquivo}: toda ligação aponta para um nó que existe`, () => {
    for (const [origem, { main }] of Object.entries(wf.connections)) {
      assert.ok(nos[origem], `origem inexistente: ${origem}`);
      for (const destino of main.flat()) assert.ok(nos[destino.node], `${origem} → ${destino.node} inexistente`);
    }
  });

  test(`${arquivo}: todo $('Nó') citado existe`, () => {
    const texto = JSON.stringify(wf.nodes);
    for (const [, nome] of texto.matchAll(/\$\(\\?'([^'\\]+)\\?'\)/g)) {
      assert.ok(nos[nome], `referência a nó inexistente: ${nome}`);
    }
  });

  test(`${arquivo}: sem credencial embutida e só domínios de exemplo`, () => {
    for (const n of wf.nodes) assert.equal(n.credentials, undefined, `${n.name} traz credencial`);
    const urls = JSON.stringify(wf).match(/https?:\/\/[^\s"'<>{}]+/g) || [];
    for (const u of urls) assert.match(u, /^https:\/\/[a-z]+\.exemplo\.com\b/, `URL fora do padrão: ${u}`);
  });
}

test('Ação?: cada saída leva ao caminho certo', () => {
  const { wf, nos } = carregarWorkflow('protocolo-por-ligacao.json');
  const rotulos = nos['Ação?'].parameters.rules.values.map((r) => r.outputKey);
  const destinos = wf.connections['Ação?'].main.map((saida) => saida[0].node);
  assert.deepEqual(rotulos, ['criar', 'atualizar', 'aguardar', 'ignorar']);
  assert.deepEqual(destinos, ['Busca Contato', 'Atualiza Ticket', 'Aguarda Ticket', 'Log Ticket']);
  assert.deepEqual(wf.connections['Aguarda Ticket'].main[0].map((d) => d.node), ['Anti-duplicado']);
});
