/**
 * Para quem, com que marca e por qual endereco.
 *
 * Todo gatilho de e-mail do provedor precisa das mesmas tres respostas, e as
 * tres ja foram respondidas errado antes:
 *
 * - PARA QUEM: `providers.contactEmail` quando existe; senao os administradores
 *   do provedor. A NsLink esta cadastrada sem e-mail de contato, e o alerta
 *   anti-fraude era descartado com um aviso no log — ninguem ficava sabendo.
 * - QUAL MARCA: a do PROVEDOR (`resolverMarcaPorId`), nunca a do host de onde a
 *   requisicao veio. Um e-mail assinado "Consulta ISP" para quem comprou da
 *   "CredNet" entrega o revendedor.
 * - QUAL ENDERECO: `urlDeEntrada`, que e por onde ESTE provedor consegue
 *   entrar. `urlDaMarca` cai na raiz da plataforma quando nao ha dominio
 *   proprio ativo, e la o login e recusado por desenho: o provedor clicava no
 *   botao do e-mail e caia numa pagina de vendas ou numa recusa de acesso.
 *
 * Concentrar isso aqui e o que impede a quarta versao ligeiramente diferente
 * da mesma regra.
 */
import { storage } from "../storage";
import { logger } from "../logger";
import { resolverMarcaPorId, urlDeEntrada, MARCA_PLATAFORMA, type MarcaResolvida } from "./marca.service";

/** O minimo do provedor que este modulo precisa. */
export interface ProvedorParaEmail {
  id: number;
  name: string;
  contactEmail?: string | null;
  marcaId?: number | null;
  subdomain?: string | null;
}

export interface ContextoDeEmail {
  /** Enderecos que devem receber. Vazio significa: nao ha a quem avisar. */
  para: string[];
  marca: MarcaResolvida;
  /** Base por onde o destinatario entra, para os links do e-mail. */
  urlBase: string;
  /** Nome para a saudacao: o do provedor, que serve para contato e para admin. */
  nome: string;
}

/**
 * Destinatarios do provedor: o contato cadastrado ou, na falta dele, os
 * administradores. Nunca inventa endereco.
 */
export async function destinatariosDoProvedor(provedor: ProvedorParaEmail): Promise<string[]> {
  const contato = (provedor.contactEmail || "").trim();
  if (contato) return [contato];
  try {
    const usuarios = await storage.getUsersByProvider(provedor.id);
    return Array.from(new Set(
      usuarios
        .filter(u => u.role === "admin" && u.email)
        .map(u => u.email.trim().toLowerCase()),
    ));
  } catch (err: any) {
    logger.warn({ providerId: provedor.id, err: err?.message }, "[email] Nao foi possivel listar administradores do provedor");
    return [];
  }
}

/** As tres respostas de uma vez. */
export async function contextoDeEmail(provedor: ProvedorParaEmail): Promise<ContextoDeEmail> {
  const [para, marca] = await Promise.all([
    destinatariosDoProvedor(provedor),
    resolverMarcaPorId(provedor.marcaId ?? null).catch(() => MARCA_PLATAFORMA),
  ]);
  return { para, marca, urlBase: urlDeEntrada(provedor, marca), nome: provedor.name };
}

/**
 * Manda o mesmo e-mail para todos os destinatarios do provedor, sem deixar a
 * falha de envio derrubar a operacao que o disparou.
 *
 * Esta e a regra que ja valia nos tres e-mails antigos e que precisa valer nos
 * novos: aprovar um cadastro, liberar credito ou suspender um provedor sao
 * atos que TERMINARAM. Se o Resend estiver fora do ar, o ato continua feito; o
 * que se perde e o aviso, e isso vai para o log.
 */
export async function avisarProvedor(
  provedor: ProvedorParaEmail,
  enviar: (para: string, ctx: ContextoDeEmail) => Promise<void>,
  rotulo: string,
): Promise<void> {
  try {
    const ctx = await contextoDeEmail(provedor);
    if (ctx.para.length === 0) {
      logger.warn({ providerId: provedor.id, rotulo }, "[email] Provedor sem e-mail de contato nem administrador: aviso nao enviado");
      return;
    }
    for (const para of ctx.para) {
      try {
        await enviar(para, ctx);
      } catch (err: any) {
        logger.error({ providerId: provedor.id, rotulo, err: err?.message }, "[email] Falha ao enviar aviso ao provedor");
      }
    }
  } catch (err: any) {
    logger.error({ providerId: provedor.id, rotulo, err: err?.message }, "[email] Falha ao montar o aviso ao provedor");
  }
}
