import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * O formulario de credencial de um conector ERP — um so, compartilhado.
 *
 * Ele nasceu recortado do Painel do Provedor porque a configuracao mudou de
 * lugar: quem edita credencial agora e o superadmin, e o painel do provedor
 * virou vitrine. Recortar (em vez de reescrever no admin) e o ponto: os dois
 * mapeamentos abaixo carregam um bug que ja foi para producao, e existe um so
 * lugar onde ele pode voltar a acontecer.
 *
 * O componente NAO fala com a rede. Ele guarda estado de formulario e devolve
 * o corpo pronto por callback; quem chama decide se manda para a rota do
 * provedor ou para a do superadmin.
 *
 * Estilo em token puro (DESIGN_SYSTEM v5.0): nenhuma cor da paleta default do
 * Tailwind, profundidade por hairline de 1px, raio 4px em campo e botao.
 */

export interface CampoErp {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
}

export interface ConectorMeta {
  name: string;
  label: string;
  configFields: CampoErp[];
}

export interface OcupadoErp {
  salvando?: boolean;
  testando?: boolean;
  sincronizando?: boolean;
}

export interface ResultadoTesteErp {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface ResultadoSyncErp {
  tipo: "info" | "erro" | "ok";
  texto: string;
}

export interface FormularioErpProps {
  conector: ConectorMeta;
  integracao?: any;
  ocupado?: OcupadoErp;
  resultadoTeste?: ResultadoTesteErp | null;
  resultadoSync?: ResultadoSyncErp | null;
  onSalvar: (corpo: Record<string, unknown>) => void;
  onTestar?: () => void;
  onSincronizar?: () => void;
}

/**
 * Os campos que a tela precisa desenhar para este conector.
 *
 * IXC, MK e Voalle nao declaram `apiUrl` em configFields — para eles a URL
 * nunca foi campo de tela. Mas as rotas de test e de sync exigem apiUrl para
 * montar a configuracao do conector, entao sem acrescentar o campo aqui esses
 * tres ERPs ficam impossiveis de configurar: o operador salva, o teste falha
 * por falta de URL, e nao ha onde digita-la.
 */
export function camposDoConector(conector: ConectorMeta): CampoErp[] {
  const declarados = conector.configFields ?? [];
  if (declarados.some(c => c.key === "apiUrl")) return declarados;
  return [
    {
      key: "apiUrl",
      label: "URL da API",
      type: "url",
      required: true,
      placeholder: "https://seudominio.com.br",
    },
    ...declarados,
  ];
}

/**
 * Le de um registro de integracao o valor que preenche um campo da tela.
 *
 * Espelha o corpoDoFormulario: o que ele grava, este le de volta. Sem isto,
 * reabrir a integracao mostrava o campo vazio e um Salvar seguido apagava o
 * valor salvo.
 */
export function valorDoCampo(key: string, registro: any): string {
  if (key === "apiUrl") return registro?.apiUrl ?? "";
  if (key === "apiToken") return registro?.apiToken ?? "";
  if (key === "apiUser") return registro?.apiUser ?? "";
  if (key === "mkContraSenha") return registro?.mkContraSenha ?? "";
  if (key === "extra.clientId") return registro?.clientId ?? "";
  if (key === "extra.clientSecret") return registro?.clientSecret ?? "";
  if (key.startsWith("extra.")) return registro?.extraConfig?.[key.slice(6)] ?? "";
  return "";
}

/** Monta o corpo da requisicao a partir dos campos declarados pelo conector. */
export function corpoDoFormulario(
  campos: CampoErp[],
  valores: Record<string, string>,
): Record<string, unknown> {
  const body: Record<string, any> = {};
  const extra: Record<string, string> = {};
  campos.forEach(f => {
    const val = valores[f.key] ?? "";
    if (f.key === "apiUrl") body.apiUrl = val;
    else if (f.key === "apiToken") body.apiToken = val;
    else if (f.key === "apiUser") body.apiUser = val;
    else if (f.key === "mkContraSenha") body.mkContraSenha = val;
    else if (f.key === "extra.clientId") body.clientId = val;
    else if (f.key === "extra.clientSecret") body.clientSecret = val;
    // Qualquer outro "extra.*" declarado pelo conector vai inteiro no
    // extraConfig. Antes esta cadeia de ifs era a lista fechada do que
    // sobrevivia ao Salvar: o campo era renderizado, o operador digitava, e o
    // que nao estivesse aqui era descartado antes de virar requisicao. Era o
    // caso da contra-senha do MK e do nome do app do SGP — os dois
    // obrigatorios, os dois perdidos em silencio.
    else if (f.key.startsWith("extra.")) extra[f.key.slice(6)] = val;
  });
  if (Object.keys(extra).length > 0) body.extraConfig = extra;
  return body;
}

/* ------------------------------------------------------------------ */
/* Icones inline. O modulo fica sem dependencia de runtime de proposito:
   as tres funcoes acima sao testadas em vitest puro, e um barrel de icones
   arrastaria milhares de modulos para dentro do teste.                */
/* ------------------------------------------------------------------ */

const svgBase = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconeOlho({ aberto }: { aberto: boolean }) {
  return aberto ? (
    <svg {...svgBase} aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg {...svgBase} aria-hidden="true">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.5 18.5 0 0 0 2 12s3.5 8 10 8a9.1 9.1 0 0 0 5.4-1.6" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function IconeSalvar() {
  return (
    <svg {...svgBase} aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function IconeRaio() {
  return (
    <svg {...svgBase} aria-hidden="true">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconeSync() {
  return (
    <svg {...svgBase} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconeGirando() {
  return (
    <svg {...svgBase} aria-hidden="true" className="ds-erp-girando">
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */

const ESTILO_BOTAO: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  height: 36,
  padding: "0 14px",
  borderRadius: 4,
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: "-.005em",
  cursor: "pointer",
  whiteSpace: "nowrap",
  border: "1px solid transparent",
};

const ESTILO_ROTULO: CSSProperties = {
  display: "block",
  marginBottom: 5,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "var(--track-wide)",
  color: "var(--text-faint)",
};

/** Chip de resposta (teste/sync): cor de estado + rotulo, nunca so cor. */
function ChipResposta({ tom, children }: { tom: "ok" | "erro" | "info"; children: React.ReactNode }) {
  const paleta =
    tom === "ok"
      ? { fg: "var(--ok)", bg: "var(--ok-bg)", bd: "var(--ok-border)" }
      : tom === "erro"
        ? { fg: "var(--danger)", bg: "var(--danger-bg)", bd: "var(--danger-border)" }
        : { fg: "var(--info)", bg: "var(--info-bg)", bd: "var(--info-border)" };
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 500,
        letterSpacing: ".04em", padding: "4px 8px", borderRadius: 4,
        fontVariantNumeric: "tabular-nums",
        background: paleta.bg, color: paleta.fg, border: `1px solid ${paleta.bd}`,
      }}
    >
      {children}
    </span>
  );
}

export default function FormularioErp({
  conector,
  integracao,
  ocupado,
  resultadoTeste,
  resultadoSync,
  onSalvar,
  onTestar,
  onSincronizar,
}: FormularioErpProps) {
  const campos = useMemo(() => camposDoConector(conector), [conector]);

  const semente = useMemo(() => {
    const v: Record<string, string> = {};
    campos.forEach(c => { v[c.key] = valorDoCampo(c.key, integracao); });
    return v;
  }, [campos, integracao]);

  const [valores, setValores] = useState<Record<string, string>>(semente);
  const [ativo, setAtivo] = useState<boolean>(!!integracao?.isEnabled);
  const [revelado, setRevelado] = useState<Record<string, boolean>>({});

  // Reseeda so quando o registro REALMENTE mudou de conteudo. Um efeito
  // disparado por identidade de objeto (a query refaz o objeto a cada
  // resposta) apagaria o que o operador esta digitando no meio da edicao.
  const assinaturaRef = useRef<string | null>(null);
  useEffect(() => {
    const assinatura = JSON.stringify(semente) + "|" + String(!!integracao?.isEnabled);
    if (assinaturaRef.current === assinatura) return;
    assinaturaRef.current = assinatura;
    setValores(semente);
    setAtivo(!!integracao?.isEnabled);
  }, [semente, integracao]);

  // O botao de testar/sincronizar age sobre a credencial JA SALVA no servidor,
  // nao sobre o que esta na tela — por isso a checagem olha o registro.
  // `configurado` e o campo do resumo do provedor; o registro do superadmin vem
  // decifrado e responde pelas colunas.
  const temCredencial: boolean =
    typeof integracao?.configurado === "boolean"
      ? integracao.configurado
      : !!(integracao?.apiUrl && integracao?.apiToken);

  const salvando = !!ocupado?.salvando;
  const testando = !!ocupado?.testando;
  const sincronizando = !!ocupado?.sincronizando;

  const salvar = () => {
    onSalvar({ ...corpoDoFormulario(campos, valores), isEnabled: ativo });
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
      data-testid={`form-erp-${conector.name}`}
    >
      {/* Liga/desliga da integracao — entra no corpo como isEnabled */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 12px", borderRadius: 8,
          background: "var(--surface-2)", border: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", letterSpacing: "var(--track-tight)" }}>
            integracao ativa
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            Desligada, a sincronizacao automatica nao roda para este ERP.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ativo}
          aria-label="Integracao ativa"
          className="ds-ctl ds-erp-alvo"
          onClick={() => setAtivo(v => !v)}
          data-testid={`switch-erp-${conector.name}`}
          style={{
            position: "relative", width: 44, height: 26, flexShrink: 0,
            borderRadius: 9999, cursor: "pointer", padding: 0,
            border: "1px solid var(--border-strong)",
            background: ativo ? "var(--action)" : "var(--surface-3)",
            transition: "background .15s",
          }}
        >
          <span
            style={{
              position: "absolute", top: 2, left: ativo ? 20 : 2,
              width: 20, height: 20, borderRadius: 9999,
              background: "var(--surface)",
              boxShadow: "0 0 0 1px var(--border-strong)",
              transition: "left .15s",
            }}
          />
        </button>
      </div>

      {/* Campos declarados pelo conector */}
      <div
        style={{
          display: "grid", gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        {campos.map(campo => {
          const senha = campo.type === "password";
          const aberto = !!revelado[campo.key];
          return (
            <div key={campo.key}>
              <label style={ESTILO_ROTULO} htmlFor={`erp-${conector.name}-${campo.key}`}>
                {campo.label}
                {campo.required && <span style={{ color: "var(--danger)", marginLeft: 3 }}>*</span>}
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id={`erp-${conector.name}-${campo.key}`}
                  className="ds-input ds-erp-campo"
                  type={senha && !aberto ? "password" : "text"}
                  placeholder={campo.placeholder ?? ""}
                  value={valores[campo.key] ?? ""}
                  onChange={e => {
                    const valor = e.target.value;
                    setValores(prev => ({ ...prev, [campo.key]: valor }));
                  }}
                  data-testid={`input-${conector.name}-${campo.key}`}
                  style={{
                    width: "100%", height: 38, borderRadius: 4,
                    // 44px de folga do lado da senha: e o que o alvo de toque do
                    // olho ocupa (.ds-erp-alvo-lateral). Menos que isso e o
                    // alvo avanca sobre a area de texto do campo.
                    padding: senha ? "0 44px 0 10px" : "0 10px",
                    background: "var(--surface)", color: "var(--text)",
                    fontFamily: "var(--font-mono)", fontSize: 12.5,
                    fontVariantNumeric: "tabular-nums",
                    outline: "none",
                  }}
                />
                {senha && (
                  <button
                    type="button"
                    className="ds-ctl ds-erp-alvo-lateral"
                    aria-label={aberto ? `Ocultar ${campo.label}` : `Mostrar ${campo.label}`}
                    onClick={() => setRevelado(prev => ({ ...prev, [campo.key]: !prev[campo.key] }))}
                    data-testid={`revelar-${conector.name}-${campo.key}`}
                    style={{
                      // Centrado por transform, e nao por `top` fixo: no dedo o
                      // campo cresce para 44px e um deslocamento cravado
                      // deixaria o olho fora do eixo.
                      position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
                      width: 34, height: 34, borderRadius: 4,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "transparent", border: "1px solid transparent",
                      color: "var(--text-muted)", cursor: "pointer",
                    }}
                  >
                    <IconeOlho aberto={aberto} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Acoes — cada botao com o SEU proprio estado de ocupado. No painel
          antigo um unico isPending desabilitava o Salvar de todos os cards ao
          mesmo tempo; aqui cada instancia cuida de um conector so. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="ds-ctl ds-erp-botao"
          data-variant="primary"
          onClick={salvar}
          disabled={salvando}
          data-testid={`button-save-erp-${conector.name}`}
          style={{
            ...ESTILO_BOTAO,
            background: salvando ? "var(--surface-3)" : "var(--action)",
            color: salvando ? "var(--text-muted)" : "var(--text-on-brand)",
            cursor: salvando ? "not-allowed" : "pointer",
          }}
        >
          {salvando ? <IconeGirando /> : <IconeSalvar />}
          Salvar Configuracao
        </button>

        <button
          type="button"
          className="ds-ctl ds-erp-botao"
          data-variant="ghost"
          onClick={onTestar}
          disabled={testando || !temCredencial || !onTestar}
          data-testid={`button-test-erp-${conector.name}`}
          style={{
            ...ESTILO_BOTAO,
            background: "var(--surface)",
            color: "var(--text-2)",
            border: "1px solid var(--border-strong)",
            opacity: testando || !temCredencial || !onTestar ? 0.55 : 1,
            cursor: testando || !temCredencial || !onTestar ? "not-allowed" : "pointer",
          }}
        >
          {testando ? <IconeGirando /> : <IconeRaio />}
          Testar Conexao
        </button>

        <button
          type="button"
          className="ds-ctl ds-erp-botao"
          data-variant="ghost"
          onClick={onSincronizar}
          disabled={sincronizando || !temCredencial || !onSincronizar}
          data-testid={`button-sync-erp-${conector.name}`}
          style={{
            ...ESTILO_BOTAO,
            background: "var(--surface)",
            color: "var(--text-2)",
            border: "1px solid var(--border-strong)",
            opacity: sincronizando || !temCredencial || !onSincronizar ? 0.55 : 1,
            cursor: sincronizando || !temCredencial || !onSincronizar ? "not-allowed" : "pointer",
          }}
        >
          {sincronizando ? <IconeGirando /> : <IconeSync />}
          Sincronizar Agora
        </button>
      </div>

      {(resultadoTeste || resultadoSync) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {resultadoTeste && (
            <ChipResposta tom={resultadoTeste.ok ? "ok" : "erro"}>
              <span data-testid={`resultado-teste-${conector.name}`}>
                {resultadoTeste.ok ? "conexao ok" : resultadoTeste.message}
              </span>
              {typeof resultadoTeste.latencyMs === "number" && (
                <span style={{ color: "var(--text-muted)" }}>
                  {resultadoTeste.latencyMs.toLocaleString("pt-BR")} ms
                </span>
              )}
            </ChipResposta>
          )}
          {resultadoSync && (
            <ChipResposta tom={resultadoSync.tipo === "ok" ? "ok" : resultadoSync.tipo === "erro" ? "erro" : "info"}>
              <span data-testid={`resultado-sync-${conector.name}`}>{resultadoSync.texto}</span>
            </ChipResposta>
          )}
        </div>
      )}
    </div>
  );
}
