import { createHash } from "crypto";
import { validarCPF } from "../../utils/cpf-cnpj-validator";
import type { VinculoIdentidade, EstadoIdentidade } from "@shared/chat-autonomia";
export type { VinculoIdentidade, EstadoIdentidade } from "@shared/chat-autonomia";
const normalizarNome = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").trim().replace(/\s+/g, " ");
const DESAFIO = "Para proteger seus dados, informe seu nome completo e somente os últimos 4 dígitos do CPF do titular. Não envie o CPF completo. Se preferir, posso encaminhar ao atendente.";

/** Desafio determinístico: o modelo nunca confirma identidade nem recebe o documento. */
export function avaliarIdentidade(estado: EstadoIdentidade | null, vinculo: VinculoIdentidade, cadastro: { nome: string; documento: string }, texto: string, messageId: string, agora = new Date()): { acao: "confirmada" | "desafiar" | "humano"; estado: EstadoIdentidade | null; mensagem: string } {
  const documento = cadastro.documento.replace(/\D/g, "");
  const nome = normalizarNome(cadastro.nome);
  if (!validarCPF(documento) || nome.split(" ").length < 2 || !/^55\d{10,11}$/.test(vinculo.telefone)) return { acao: "humano", estado: null, mensagem: "Identificação exige conferência do atendente." };
  const cadastroHash = createHash("sha256").update(`${nome}:${documento}`).digest("hex");
  const mesmoVinculo = estado && estado.providerId === vinculo.providerId && estado.conversationId === vinculo.conversationId && estado.customerId === vinculo.customerId && estado.telefone === vinculo.telefone && estado.cadastroHash === cadastroHash;
  if (mesmoVinculo && estado.confirmadaEm && estado.validaAte && Date.parse(estado.confirmadaEm) <= agora.getTime() && Date.parse(estado.validaAte) > agora.getTime()) return { acao: "confirmada", estado, mensagem: "" };
  const tentativas = mesmoVinculo ? estado.tentativas : 0;
  if (tentativas >= 3) return { acao: "humano", estado, mensagem: "Limite de tentativas de identificação atingido." };
  const novo: EstadoIdentidade = { ...vinculo, cadastroHash, tentativas, desafiadaEm: agora.toISOString(), ultimaMensagemId: messageId, confirmadaEm: null, validaAte: null };
  if (!mesmoVinculo || estado.confirmadaEm) return { acao: "desafiar", estado: novo, mensagem: DESAFIO };
  if (estado.ultimaMensagemId === messageId) return { acao: "desafiar", estado, mensagem: DESAFIO };
  const digitosInformados = texto.replace(/\D/g, "");
  const tempo = agora.getTime() - Date.parse(estado.desafiadaEm);
  const correto = tempo >= 0 && tempo < 5 * 60_000 && digitosInformados === documento.slice(-4) && normalizarNome(texto.replace(/\d/g, "")) === nome;
  if (correto) return { acao: "confirmada", estado: { ...novo, confirmadaEm: agora.toISOString(), validaAte: new Date(agora.getTime() + 15 * 60_000).toISOString() }, mensagem: "Identidade confirmada. Como posso ajudar?" };
  novo.tentativas++;
  return { acao: novo.tentativas >= 3 ? "humano" : "desafiar", estado: novo, mensagem: novo.tentativas >= 3 ? "Não foi possível confirmar sua identidade; o atendente continuará." : `Não foi possível confirmar os dados. ${DESAFIO}` };
}

/** A janela do modelo não precisa de documentos nem dos dígitos usados no desafio. */
export function protegerHistorico(texto: string, documento: string): string {
  let protegido = texto.replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g, "[documento omitido]");
  const final = documento.replace(/\D/g, "").slice(-4);
  if (final.length === 4) protegido = protegido.replace(new RegExp(`\\b${final}\\b`, "g"), "[confirmação omitida]");
  return protegido;
}
