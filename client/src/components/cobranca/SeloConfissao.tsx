/**
 * O selo "título executivo assinado" (spec §6.7): aparece no 360, no card do
 * kanban e na linha da carteira quando há confissão ASSINADA VIVA. Em
 * sandbox o selo é "TESTE — sem validade jurídica": um documento de teste
 * nunca pode parecer título.
 */
import { FileSignature } from "lucide-react";
import { SELO_ASSINADA, SELO_SANDBOX } from "@shared/cobranca/confissao";
import { SeloCobranca } from "./ui";
import { dataBr } from "./formatacao";
import type { SeloDaConfissao } from "./tipos";

export function SeloConfissao({ confissao, compacto = false }: { confissao: SeloDaConfissao | null | undefined; compacto?: boolean }) {
  if (!confissao) return null;
  const sandbox = confissao.ambiente === "sandbox";
  const quando = confissao.assinadaEm ? dataBr(confissao.assinadaEm) : null;
  const titulo = sandbox
    ? `Confissão de dívida assinada em AMBIENTE DE TESTES${quando ? ` em ${quando}` : ""} — sem validade jurídica`
    : `Confissão de dívida assinada${quando ? ` em ${quando}` : ""} — título executivo extrajudicial (CPC 784, III) de R$ ${confissao.valorTotal.toFixed(2).replace(".", ",")}`;
  return (
    <SeloCobranca tom={confissao.ambiente === "sandbox" ? "gated" : "ok"} titulo={titulo} testId="selo-confissao">
      <FileSignature className="h-3 w-3" aria-hidden /> {sandbox ? (compacto ? "TESTE" : SELO_SANDBOX) : (compacto ? "título assinado" : SELO_ASSINADA)}
    </SeloCobranca>
  );
}
