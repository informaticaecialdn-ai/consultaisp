/**
 * Carregamento de tela que sobrevive a um deploy.
 *
 * O incidente de 04/09/2026, relatado como "isso esta acontecendo em cada menu
 * que clica": cada tela e um chunk separado (`React.lazy`), e o nome do arquivo
 * carrega o hash do conteudo. O `vite build` grava hashes novos e APAGA os
 * antigos. A aba que ja estava aberta continua com os nomes velhos na memoria,
 * entao o primeiro clique em qualquer menu pede um `.js` que nao existe mais:
 * 404, o import dinamico rejeita, e o ErrorBoundary troca o app inteiro pelo
 * cartao "Algo deu errado". Em CADA menu, porque todo menu e um chunk.
 *
 * Medido no log do nginx daquele dia: `/assets/anti-fraude-BtSNX9uk.js`,
 * `/assets/dashboard-CWn2P--S.js` e mais uma duzia, todos 404, no minuto exato
 * do relato.
 *
 * A defesa e em duas camadas, e esta e a segunda:
 *   1. `script/build.ts` guarda os assets dos builds anteriores, entao a aba
 *      aberta continua achando o chunk dela;
 *   2. AQUI: se mesmo assim o chunk sumir, a pagina se recarrega sozinha uma
 *      vez. O index.html sai com `Cache-Control: no-store` (server/static.ts),
 *      entao a recarga pega o build novo de verdade.
 *
 * A trava de uma vez e essencial: chunk que falha por queda de rede recarregaria
 * em laco, e o laco esconde o erro em vez de mostra-lo.
 */

/** Onde fica a marca da ultima recarga. Chave unica, no sessionStorage. */
export const CHAVE_DE_RECARGA = "consultaisp:recarga-de-chunk";

/**
 * Janela em que uma segunda falha NAO recarrega de novo.
 *
 * Um minuto cobre o intervalo entre o clique que falhou e a volta da pagina.
 * Passado isso, uma falha nova e um evento novo — provavelmente outro deploy —
 * e merece a sua propria recarga.
 */
export const JANELA_DE_TRAVA_MS = 60_000;

/**
 * Decide se vale recarregar, e ja registra a decisao.
 *
 * Separada da parte que mexe no `window` para poder ser testada com um relogio
 * e um armazem de mentira.
 */
export function deveRecarregar(
  armazem: Pick<Storage, "getItem" | "setItem">,
  agora: number,
): boolean {
  const anterior = Number(armazem.getItem(CHAVE_DE_RECARGA) ?? NaN);
  if (Number.isFinite(anterior) && agora - anterior < JANELA_DE_TRAVA_MS) {
    return false;
  }
  armazem.setItem(CHAVE_DE_RECARGA, String(agora));
  return true;
}

/**
 * Embrulha o `import()` de uma tela.
 *
 * Sucesso apaga a marca: a partir dai a proxima falha e um evento novo e ganha
 * a propria recarga.
 *
 * Na falha que autoriza recarregar, devolve uma promessa que NUNCA resolve. E
 * de proposito: a pagina esta indo embora, e resolver ou rejeitar nesse meio
 * tempo so faria o React pintar um erro que ninguem chega a ler.
 */
export function pagina<T>(importar: () => Promise<T>): () => Promise<T> {
  return () =>
    importar().then(
      (modulo) => {
        try {
          sessionStorage.removeItem(CHAVE_DE_RECARGA);
        } catch {
          // Navegador com storage bloqueado ainda tem que abrir a tela.
        }
        return modulo;
      },
      (erro) => {
        let recarregar = false;
        try {
          recarregar = deveRecarregar(sessionStorage, Date.now());
        } catch {
          // Sem storage nao da para travar o laco, entao nao recarrega:
          // mostrar o erro e melhor que recarregar para sempre.
        }
        if (!recarregar) throw erro;
        window.location.reload();
        return new Promise<T>(() => {});
      },
    );
}
