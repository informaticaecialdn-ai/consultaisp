import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Tabs} from '@/components/ui/tabs';
import {CATEGORIAS_PAINEL,categoriasDoPainel,NavegacaoPainel,InicioConfiguracoes} from './OrganizacaoPainel';
describe('Organização do painel',()=>{
 it('preserva todas as configurações em uma única categoria',()=>{
  const ids=CATEGORIAS_PAINEL.flatMap(c=>c.itens.map(i=>i.id));
  expect(ids).toHaveLength(12);expect(new Set(ids).size).toBe(12);
  expect(ids).toContain('agentes');expect(ids).toContain('cobranca');
 });
 it('encontra canais pelos nomes dos provedores e busca sem acentos',()=>{
  expect(categoriasDoPainel('uazapi',true)[0].itens.map(i=>i.id)).toEqual(['chat']);
  expect(categoriasDoPainel('socios',true)[0].itens[0].id).toBe('socios');
  expect(categoriasDoPainel('inexistente xyz',true)).toEqual([]);
 });
 it('não oferece acesso de suporte para operador',()=>{
  expect(categoriasDoPainel('',false).flatMap(c=>c.itens).some(i=>i.id==='suporte')).toBe(false);
 });
 it('renderiza gatilhos reais para os corpos de abas existentes',()=>{
  const html=renderToStaticMarkup(<Tabs value="chat"><NavegacaoPainel podeSuporte /></Tabs>);
  for(const id of ['chat','agentes','cobranca','empresa'])expect(html).toContain('data-testid="tab-'+id+'"');
  expect(html).toContain('role="tab"');expect(html).toContain('Buscar configuração');
 });
 it('a orientação inicial não inventa status de configuração',()=>{
  const html=renderToStaticMarkup(<InicioConfiguracoes onAbrir={()=>{}} podeSuporte={false}/>);
  expect(html).toContain('Cadastre a empresa');expect(html).not.toContain('100%');expect(html).not.toContain('Acesso do suporte');
 });
});
