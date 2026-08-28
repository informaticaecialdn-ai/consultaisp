import { useState, useEffect } from "react";
import { Search, MapPin, FileText, Building2, ChevronDown, ChevronUp, Shield, Lock } from "lucide-react";
import type { CepData } from "./types";
import { getDetectedType } from "./utils";
import { Kicker } from "./report-ui";

interface SearchPayload {
  cpfCnpj: string;
  addressNumber?: string;
  addressComplement?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  /** Desempatam o cruzamento de endereço; nunca são requisito dele. */
  addressNeighborhood?: string;
  addressZip?: string;
}

interface Props {
  onSearch: (payload: SearchPayload) => void;
  isLoading: boolean;
  hasResult: boolean;
  autoAddressCrossRef?: boolean;
  onClear: () => void;
  /** Copy do card. A Consulta Cadastral usa a mesma barra e não fala com ERP
      nenhum — deixar esses textos cravados faria a outra tela mentir sobre a
      origem do dado. Mesmo motivo das props do LoadingCard. */
  kicker?: string;
  selo?: string;
  /** Linhas de custo do rodapé. Vazio esconde a faixa inteira. */
  custos?: string[];
  notaLegal?: string;
  /** testid do input — o CTA do estado vazio foca por ele. Não mude sem ajustar lá. */
  inputTestId?: string;
}

/* ── Peças locais em token puro ─────────────────────────────── */

function CampoTexto({ label, obrigatorio, ...rest }: {
  label: string; obrigatorio?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
        {label}
        {obrigatorio && <span style={{ color: "var(--danger)" }}> *</span>}
      </span>
      <input
        {...rest}
        className="ds-input"
        style={{
          height: 38, padding: "0 12px", width: "100%", boxSizing: "border-box",
          fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text)",
          background: "var(--surface)",
          borderRadius: 8, outline: "none",
        }}
      />
    </label>
  );
}

function BotaoBarra({ variant = "ghost", ...rest }: {
  variant?: "ghost" | "primary";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      className="ds-ctl"
      {...rest}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        height: 42, padding: primary ? "0 20px" : "0 18px", borderRadius: 8,
        fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? .55 : 1,
        background: primary ? "var(--action)" : "var(--surface)",
        color: primary ? "var(--text-on-brand)" : "var(--text-2)",
        border: primary ? "1px solid transparent" : "1px solid var(--border-strong)",
        whiteSpace: "nowrap", ...rest.style,
      }}
    />
  );
}

export default function ConsultaSearchBar({
  onSearch, isLoading, hasResult, autoAddressCrossRef, onClear,
  kicker = "Nova consulta · documento ou endereço",
  selo = "Rede ISP colaborativa",
  custos = [
    "Registro do seu ERP · grátis",
    "Ocorrência em parceiro · 1 crédito",
    "Nada consta · grátis",
  ],
  notaLegal = "Consulta registrada para auditoria · LGPD art. 7º, X — proteção ao crédito",
  inputTestId = "input-isp-search",
}: Props) {
  const [query, setQuery] = useState("");
  const [cepData, setCepData] = useState<CepData | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");

  const [showInstallAddr, setShowInstallAddr] = useState(false);
  const [installCepQuery, setInstallCepQuery] = useState("");
  const [installCepData, setInstallCepData] = useState<CepData | null>(null);
  const [installCepLoading, setInstallCepLoading] = useState(false);
  const [installCepError, setInstallCepError] = useState("");
  const [installNumber, setInstallNumber] = useState("");
  const [installComplement, setInstallComplement] = useState("");

  const detectedType = getDetectedType(query);

  // Digitar um CPF de 11 digitos passa por 8 digitos no meio do caminho, o que dispara
  // esta busca de CEP. Sem o guard de cancelamento a resposta tardia chegava depois do
  // else ter limpado o estado e reescrevia "CEP nao encontrado" — a tela mostrava
  // "CPF detectado" e o erro de CEP ao mesmo tempo.
  useEffect(() => {
    let cancelado = false;
    const digits = query.replace(/\D/g, "");
    if (digits.length === 8) {
      setCepData(null);
      setCepError("");
      setCepLoading(true);
      fetch(`https://viacep.com.br/ws/${digits}/json/`)
        .then(r => r.json())
        .then((d: CepData) => {
          if (cancelado) return;
          if (d.erro) {
            setCepError("CEP não encontrado. Verifique o número.");
          } else {
            setCepData(d);
          }
        })
        .catch(() => { if (!cancelado) setCepError("Erro ao buscar CEP. Tente novamente."); })
        .finally(() => { if (!cancelado) setCepLoading(false); });
    } else {
      setCepData(null);
      setCepError("");
      // OBRIGATORIO: quando a busca e cancelada no meio (digitou o 9o digito), o
      // .finally da requisicao antiga e pulado pelo guard. Sem esta linha cepLoading
      // ficaria true para sempre e o botao Consultar nunca reabilitaria.
      setCepLoading(false);
      setAddressNumber("");
      setAddressComplement("");
    }
    return () => { cancelado = true; };
  }, [query]);

  // Mesmo guard de cancelamento do efeito acima.
  useEffect(() => {
    let cancelado = false;
    const digits = installCepQuery.replace(/\D/g, "");
    if (digits.length === 8) {
      setInstallCepData(null);
      setInstallCepError("");
      setInstallCepLoading(true);
      fetch(`https://viacep.com.br/ws/${digits}/json/`)
        .then(r => r.json())
        .then((d: CepData) => {
          if (cancelado) return;
          if (d.erro) {
            setInstallCepError("CEP não encontrado. Verifique o número.");
          } else {
            setInstallCepData(d);
          }
        })
        .catch(() => { if (!cancelado) setInstallCepError("Erro ao buscar CEP. Tente novamente."); })
        .finally(() => { if (!cancelado) setInstallCepLoading(false); });
    } else {
      setInstallCepData(null);
      setInstallCepError("");
      setInstallCepLoading(false);  // mesmo motivo do efeito acima
      setInstallNumber("");
      setInstallComplement("");
    }
    return () => { cancelado = true; };
  }, [installCepQuery]);

  const handleSearch = () => {
    if (!query.trim()) return;
    const digits = query.replace(/\D/g, "");
    const isCep = digits.length === 8;

    onSearch({
      cpfCnpj: query,
      addressNumber: isCep ? addressNumber.trim() : undefined,
      addressComplement: isCep ? addressComplement.trim() : undefined,
      addressStreet: isCep && cepData ? cepData.logradouro : undefined,
      addressCity: isCep && cepData ? cepData.localidade : undefined,
      addressState: isCep && cepData ? cepData.uf : undefined,
    });
  };

  const handleClear = () => {
    setQuery("");
    setCepData(null);
    setAddressNumber("");
    setAddressComplement("");
    setShowInstallAddr(false);
    setInstallCepQuery("");
    setInstallCepData(null);
    setInstallCepError("");
    setInstallNumber("");
    setInstallComplement("");
    onClear();
  };

  /* Rótulo de detecção: verde só para CPF, azure para CEP/CNPJ — é informação
     de tipo, não juízo de risco. */
  const deteccao = cepLoading
    ? { label: "Buscando CEP…", cor: "var(--info)", Icone: MapPin }
    : detectedType === "CEP"
      ? { label: "CEP detectado — informe o número do imóvel", cor: "var(--info)", Icone: MapPin }
      : detectedType === "CPF"
        ? { label: "CPF detectado", cor: "var(--ok)", Icone: FileText }
        : detectedType === "CNPJ"
          ? { label: "CNPJ detectado", cor: "var(--info)", Icone: Building2 }
          : null;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ padding: "18px 22px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* Kicker + selo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Kicker>{kicker}</Kicker>
          {selo && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              color: "var(--brand-ink)", fontSize: 12, fontWeight: 600,
            }}>
              <Shield size={13} /> {selo}
            </div>
          )}
        </div>

        {/* Input + ações */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              className="ds-input"
              data-testid={inputTestId}
              placeholder="CPF, CNPJ ou CEP"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (hasResult) onClear(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !cepData) handleSearch(); }}
              style={{
                width: "100%", boxSizing: "border-box", height: 42, padding: "0 14px",
                fontFamily: "var(--font-mono)", fontSize: 15, letterSpacing: "0.02em",
                fontVariantNumeric: "tabular-nums", color: "var(--text)",
                background: "var(--surface)",
                borderRadius: 8, outline: "none",
              }}
            />
            <div style={{ minHeight: 18, marginTop: 6 }}>
              {cepError ? (
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                  color: "var(--danger)",
                }}>
                  {cepError}
                </span>
              ) : deteccao ? (
                <span
                  data-testid="text-detected-type"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                    color: deteccao.cor,
                  }}
                >
                  <deteccao.Icone size={12} /> {deteccao.label}
                </span>
              ) : null}
            </div>
          </div>

          {/* Limpar e Consultar ficam SEMPRE montados. Antes eles sumiam quando
              o painel de CEP abria e reapareciam como um segundo par dentro do
              painel — dois "Consultar" na mesma tela, em lugares diferentes,
              dependendo do que você digitou. */}
          <BotaoBarra onClick={handleClear} data-testid="button-clear-isp">Limpar</BotaoBarra>
          <BotaoBarra
            variant="primary"
            onClick={handleSearch}
            disabled={!query.trim() || isLoading || cepLoading || (!!cepData && !addressNumber.trim())}
            data-testid="button-consultar-isp"
          >
            {cepData ? <MapPin size={15} /> : <Search size={15} />}
            {isLoading ? "Consultando…" : "Consultar"}
          </BotaoBarra>
        </div>

        {/* Painel de CEP — azure, informação neutra */}
        {cepData && (
          <div style={{
            border: "1px solid var(--info-border)", background: "var(--info-bg)",
            borderRadius: 8, padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 12,
          }} data-testid="cep-expanded-panel">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <Kicker style={{ fontSize: 9, color: "var(--info)" }}>Endereço localizado</Kicker>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3, color: "var(--text)" }}>
                  {cepData.logradouro}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
                  {cepData.bairro} · {cepData.localidade}/{cepData.uf}
                </div>
              </div>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "var(--track-wide)",
                padding: "3px 9px", borderRadius: 6, whiteSpace: "nowrap",
                background: "var(--surface)", color: "var(--info)",
                border: "1px solid var(--info-border)",
              }}>
                CEP confirmado
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
              <CampoTexto
                label="Número" obrigatorio
                data-testid="input-address-number"
                placeholder="Ex.: 142"
                value={addressNumber}
                onChange={(e) => setAddressNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                autoFocus
              />
              <CampoTexto
                label="Complemento (opcional)"
                data-testid="input-address-complement"
                placeholder="Apto 12, Bloco B…"
                value={addressComplement}
                onChange={(e) => setAddressComplement(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              />
            </div>

            <p style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              CPF limpo não significa bom pagador — o inadimplente troca de documento, o endereço fica.
              Este cruzamento passa pelos ERPs de todos os provedores parceiros da sua região.
            </p>
          </div>
        )}

        {/* Endereço de instalação — fallback quando o ERP não devolve endereço */}
        {(detectedType === "CPF" || detectedType === "CNPJ") && (!hasResult || autoAddressCrossRef !== true) && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <button
              type="button"
              className="ds-ctl"
              onClick={() => setShowInstallAddr(p => !p)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", background: "var(--surface-2)", border: "none",
                cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "var(--text-2)" }}>
                <MapPin size={14} style={{ color: "var(--text-muted)" }} />
                Verificar também por endereço de instalação
              </span>
              {showInstallAddr
                ? <ChevronUp size={14} style={{ color: "var(--text-muted)" }} />
                : <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />}
            </button>

            {showInstallAddr && (
              <div style={{
                padding: "12px 14px", borderTop: "1px solid var(--border)",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Informe o CEP de instalação para cruzar com a rede ISP. Útil quando o ERP não devolve
                  endereço estruturado.
                </p>

                <input
                  placeholder="CEP de instalação (8 dígitos)"
                  value={installCepQuery}
                  onChange={(e) => setInstallCepQuery(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="ds-input"
                  data-testid="input-install-cep"
                  style={{
                    height: 38, padding: "0 12px", width: "100%", boxSizing: "border-box",
                    fontFamily: "var(--font-mono)", fontSize: 13, fontVariantNumeric: "tabular-nums",
                    color: "var(--text)", background: "var(--surface)",
                    borderRadius: 8, outline: "none",
                  }}
                />
                {installCepLoading && (
                  <Kicker style={{ color: "var(--info)" }}>Buscando CEP…</Kicker>
                )}
                {installCepError && (
                  <Kicker style={{ color: "var(--danger)" }}>{installCepError}</Kicker>
                )}

                {installCepData && (
                  <div style={{
                    border: "1px solid var(--info-border)", background: "var(--info-bg)",
                    borderRadius: 8, padding: "12px 14px",
                    display: "flex", flexDirection: "column", gap: 10,
                  }}>
                    <div>
                      <Kicker style={{ fontSize: 9, color: "var(--info)" }}>Endereço localizado</Kicker>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3, color: "var(--text)" }}>
                        {installCepData.logradouro}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {installCepData.bairro} · {installCepData.localidade}/{installCepData.uf}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
                      <CampoTexto
                        label="Número" obrigatorio
                        placeholder="Ex.: 142"
                        value={installNumber}
                        onChange={(e) => setInstallNumber(e.target.value)}
                        data-testid="input-install-number"
                      />
                      <CampoTexto
                        label="Complemento (opcional)"
                        placeholder="Apto 12…"
                        value={installComplement}
                        onChange={(e) => setInstallComplement(e.target.value)}
                        data-testid="input-install-complement"
                      />
                    </div>
                    <BotaoBarra
                      variant="primary"
                      style={{ width: "100%" }}
                      disabled={!installNumber.trim() || isLoading}
                      onClick={() => {
                        if (!installCepData || !installNumber.trim()) return;
                        onSearch({
                          cpfCnpj: query,
                          addressNumber: installNumber.trim(),
                          addressComplement: installComplement.trim() || undefined,
                          addressStreet: installCepData.logradouro,
                          // Bairro e CEP não são requisito do cruzamento, mas
                          // desempatam: a mesma cidade pode ter "Rua das
                          // Flores, 100" no Centro e outra no Jardim Novo.
                          addressNeighborhood: installCepData.bairro || undefined,
                          addressZip: installCepQuery || undefined,
                          addressCity: installCepData.localidade,
                          addressState: installCepData.uf,
                        });
                      }}
                      data-testid="button-install-addr-search"
                    >
                      <MapPin size={14} />
                      {isLoading ? "Consultando…" : "Consultar com endereço"}
                    </BotaoBarra>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rodapé: o preço antes da consulta, e a base legal */}
      {(custos.length > 0 || notaLegal) && (
        <div style={{
          borderTop: "1px solid var(--border-faint)", padding: "10px 22px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 14, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            {custos.map(c => (
              <span key={c} style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "var(--track-wide)",
              }}>
                {c}
              </span>
            ))}
          </div>
          {notaLegal && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-faint)" }}>
              <Lock size={11} />
              <span style={{ fontSize: 11 }}>{notaLegal}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
