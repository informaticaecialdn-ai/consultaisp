// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { ConfigGestaoSchema } from '@shared/cobranca/gestao-operacional';
import { CentroGestao } from './CentroGestao';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('carrega sob demanda, separa carteiras e abre análise sem gravar',async()=>{
 const fetcher=vi.fn(async(entrada:RequestInfo|URL)=>{
  const u=String(entrada);return new Response(JSON.stringify(u.includes('/equipe')?{usuarios:[{id:1,nome:'Operador'}]}:{config:ConfigGestaoSchema.parse({}),geradoEm:'2026-09-16T12:00:00Z',limites:{},agenda:[],promessas:[],contestacoes:[],diagnostico:[],prioridades:[],coortes:[],resultados:{confirmado:0,faturasPagas:0,diasConferencia:null,parcelasVencidas:0,parcelasCumpridas:0},contatos:[],preventivo:null}),{status:200,headers:{'Content-Type':'application/json'}});
 });vi.stubGlobal('fetch',fetcher);
 render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(CentroGestao,{carteira:'ex_cliente'})));
 expect(fetcher).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Acompanhamento financeiro e operacional'}));
 await screen.findByText('Compromissos e recebimentos');
 expect(String(fetcher.mock.calls[0][0])).toContain('carteira=ex_cliente');
 expect(screen.queryByRole('tab',{name:'Avisos de vencimento'})).toBeNull();
 fireEvent.click(screen.getByRole('tab',{name:'Contestações'}));
 fireEvent.click(screen.getByRole('button',{name:'Registrar contestação'}));
 expect(await screen.findByRole('dialog')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Registrar e pausar contatos'}).hasAttribute('disabled')).toBe(true);
 expect(fetcher.mock.calls.every(c=>String(c[0]).includes('/api/'))).toBe(true);
});
