// Roda o código dos nós Code do workflow (o mesmo texto que vai para o n8n) fora do n8n,
// simulando só o que eles usam: $json, $input, $('Nó'), $getWorkflowStaticData e o relógio.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');

function carregarWorkflow(arquivo) {
  const wf = JSON.parse(fs.readFileSync(path.join(RAIZ, 'workflows', arquivo), 'utf8'));
  const nos = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  return { wf, nos };
}

function exemplo(arquivo) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'exemplos', arquivo), 'utf8'));
}

// Relógio controlado: Date.now() devolve o tempo simulado.
function criarRelogio(inicio = Date.UTC(2026, 9, 1, 14, 0, 0)) {
  let agora = inicio;
  class DataSimulada extends Date {
    constructor(...args) { super(...(args.length ? args : [agora])); }
    static now() { return agora; }
  }
  return { Date: DataSimulada, avancar(ms) { agora += ms; }, get agora() { return agora; } };
}

// Executa um nó Code. `saidas` = saída já produzida por outros nós ({ 'Nome': json ou [json, ...] }).
function rodarCode(no, { json = {}, saidas = {}, estado = {}, relogio = criarRelogio() } = {}) {
  const itens = (nome) => {
    if (!(nome in saidas)) throw new Error(`Nó "${nome}" ainda não executou nesta simulação`);
    const v = saidas[nome];
    return (Array.isArray(v) ? v : [v]).map((j) => ({ json: j }));
  };
  const contexto = {
    $json: json,
    $input: { first: () => ({ json }), all: () => [{ json }] },
    $: (nome) => ({ first: () => itens(nome)[0], all: () => itens(nome), get item() { return itens(nome)[0]; } }),
    $getWorkflowStaticData: () => estado,
    Date: relogio.Date,
  };
  const resultado = vm.runInNewContext(`(function () {\n${no.parameters.jsCode}\n})()`, contexto);
  // ida e volta em JSON: o n8n também serializa a saída, e os objetos deixam de ser do contexto do vm
  return JSON.parse(JSON.stringify(resultado.map((i) => i.json)));
}

// Avalia um nó Filter/If com as condições simples usadas no workflow ($json.caminho + operador).
function avaliarFiltro(no, json) {
  const { conditions, combinator } = no.parameters.conditions;
  const resultados = conditions.map((c) => {
    const m = /^=\{\{\s*\$json\.([\w.]+)\s*\}\}$/.exec(c.leftValue);
    if (!m) throw new Error(`Expressão não suportada no teste: ${c.leftValue}`);
    const valor = m[1].split('.').reduce((o, k) => (o == null ? undefined : o[k]), json);
    switch (c.operator.operation) {
      case 'equals': return valor === c.rightValue;
      case 'notEquals': return valor !== c.rightValue;
      case 'notEmpty': return valor !== undefined && valor !== null && valor !== '';
      case 'true': return valor === true;
      case 'false': return valor === false;
      default: throw new Error(`Operador não suportado no teste: ${c.operator.operation}`);
    }
  });
  return combinator === 'or' ? resultados.some(Boolean) : resultados.every(Boolean);
}

module.exports = { carregarWorkflow, exemplo, criarRelogio, rodarCode, avaliarFiltro };
