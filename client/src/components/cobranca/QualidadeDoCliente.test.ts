import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect,it } from 'vitest';
import { QualidadeDoCliente } from './QualidadeDoCliente';
import type { ClienteDo360 } from './tipos';
it('mostra ausência de sincronização e não representa falta de dados como cadastro válido',()=>{
 const cliente={nome:'Cliente',dividaAtual:0,diasAtraso:0,telefone:null,email:null,contractStartDate:null} as ClienteDo360;
 const html=renderToStaticMarkup(createElement(QualidadeDoCliente,{cliente,lendo:false,onConsultar:()=>{}}));
 expect(html).toContain('Sincronização sem data confirmada');
 expect(html).toContain('Cliente sem canal de contato');
 expect(html).toContain('Conferir no ERP');
 expect(html).not.toContain('Sem divergências nos campos verificados');
});
