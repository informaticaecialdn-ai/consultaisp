/** Dados técnicos permitidos no Cliente 360. Nunca transportar senha PPPoE. */
export interface AutenticacaoCliente {
  login: string | null;
  mac: string | null;
  ip: string | null;
  contrato: string | null;
  serial: string | null;
  online: boolean | null;
  fonte: string;
  /**
   * Serviço cortado no ERP. `null` quando o ERP não diz.
   *
   * NÃO é o mesmo que `online`: bloqueio é uma decisão do provedor (corte por
   * atraso, a pedido, fraude) e sessão é o estado do rádio agora. O MK, que é
   * quem preenche este campo hoje, informa o bloqueio e NÃO informa sessão —
   * por isso os dois campos existem separados e nenhum deles é deduzido do
   * outro.
   */
  bloqueada?: boolean | null;
}

export function normalizarMac(v: unknown): string | null {
  if (typeof v !== "string" || !/^[a-f\d:.\-\s]+$/i.test(v)) return null;
  const mac = v.replace(/[:.\-\s]/g, "").toUpperCase();
  return /^[A-F\d]{12}$/.test(mac) &&
    mac !== "000000000000" &&
    mac !== "FFFFFFFFFFFF"
    ? mac
    : null;
}
const serial = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim()
    ? v.trim()
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;
const objeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** Usa apenas os campos efetivamente devolvidos. Serviço sem login continua visível pelo MAC. */
export function autenticacoesDoSgp(
  contratos: unknown[],
): AutenticacaoCliente[] {
  return contratos.flatMap((raw) => {
    const ct = objeto(raw);
    const servicos = Array.isArray(ct.servicos) ? ct.servicos : [ct];
    return servicos.flatMap((rawServico) => {
      const s = objeto(rawServico);
      const login = texto(s.login ?? s.servico_login);
      const mac = normalizarMac(s.mac ?? s.servico_mac);
      const serie = serial(s.serial ?? s.servico_serial);
      if (!login && !mac && !serie) return [];
      return [
        {
          login,
          mac,
          serial: serie,
          ip: texto(s.ip ?? s.servico_ip),
          contrato: texto(ct.contrato ?? ct.contratoId),
          online: typeof s.online === "boolean" ? s.online : null,
          fonte: "sgp",
        },
      ];
    });
  });
}

const simNao = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s === "sim" || s === "s" || s === "true" || s === "1") return true;
  if (s === "não" || s === "nao" || s === "n" || s === "false" || s === "0")
    return false;
  return null;
};

/** Serial de ONU tem forma fixa: 4 letras do fabricante + 8 hex (ALCLFCC84ABD). */
const FORMA_DE_SERIAL_ONU = /^([A-Z]{4}[0-9A-F]{8})(?:-\d{1,4})?$/;

/**
 * O serial da ONU quando o MK o guarda no lugar do login.
 *
 * Medido no MK da NsLink em 06/09/2026 (`script/probe-mk-conexoes.ts`): a
 * conexão FTTH não tem campo de serial — `username` vem `ALCLFCC84ABD-000`, que
 * é o serial da ONU com o índice da porta colado no fim. O sufixo é do MK, não
 * do aparelho, e sai.
 *
 * Só reconhece o serial quando a tecnologia é fibra E o login tem exatamente a
 * forma de serial de ONU. Um login PPPoE (`fulano@provedor.com`) nunca passa —
 * chamar login de serial cruzaria o inventário por um identificador que não é
 * do aparelho.
 */
export function serialDeOnuMk(
  username: unknown,
  tecnologia: unknown,
): string | null {
  const u = typeof username === "string" ? username.trim().toUpperCase() : "";
  const t = typeof tecnologia === "string" ? tecnologia.trim().toLowerCase() : "";
  if (!/^(ftth|gpon|epon|xpon|pon|fibra)/.test(t)) return null;
  const m = FORMA_DE_SERIAL_ONU.exec(u);
  return m ? m[1] : null;
}

/** O que `WSMKConexoesPorCliente` diz sobre a instalação do cliente. */
export interface LeituraDeConexoesMk {
  autenticacoes: AutenticacaoCliente[];
  /**
   * Alguma conexão bloqueada. `null` quando não há conexão cadastrada ou
   * nenhuma delas disse — ausência de resposta não vira "liberada".
   */
  bloqueada: boolean | null;
}

/**
 * Lê `WSMKConexoesPorCliente`. `null` quando o MK não respondeu de forma
 * legível — erro com HTTP 200 incluído, que não é "nenhuma conexão".
 *
 * Campos conferidos na resposta real do MK da NsLink em 06/09/2026:
 * `codconexao`, `contrato`, `username`, `mac_address`, `bloqueada` (Sim/Não),
 * `motivo_bloqueio`, `esta_reduzida`, `tecnologia` (Wireless/Ftth), `cadastro`,
 * mais o endereço de instalação. **Não existe IP e não existe estado de
 * sessão** nessa release, então `ip` e `online` saem `null`: o painel mostra
 * "—", nunca "offline". Os nomes alternativos aceitos abaixo são tolerância a
 * outras releases, não campos observados.
 *
 * `endereco` é o endereço postal da instalação e nunca é lido como IP.
 */
export function conexoesDoMk(corpo: unknown): LeituraDeConexoesMk | null {
  const raiz = objeto(corpo);
  if (
    String(raiz.status ?? "")
      .trim()
      .toUpperCase() === "ERRO" ||
    raiz.CODIGO_ERRO !== undefined
  ) {
    return null;
  }
  const lista = Array.isArray(corpo)
    ? corpo
    : (raiz.Conexoes ?? raiz.conexoes ?? raiz.registros ?? raiz.data);
  if (!Array.isArray(lista)) return null;

  let algumaBloqueada = false;
  let algumaLiberada = false;
  const autenticacoes: AutenticacaoCliente[] = [];

  for (const bruto of lista) {
    const c = objeto(bruto);
    const bloqueada = simNao(
      c.bloqueada ?? c.Bloqueada ?? c.bloqueado ?? c.Bloqueado ?? c.blocked,
    );
    if (bloqueada === true) algumaBloqueada = true;
    if (bloqueada === false) algumaLiberada = true;

    const login = texto(c.username ?? c.usuario ?? c.login ?? c.Login);
    const mac = normalizarMac(
      c.mac_address ?? c.macaddress ?? c.MacAddress ?? c.mac ?? c.Mac,
    );
    const serie =
      serial(c.serial ?? c.numero_serie ?? c.nro_serie ?? c.serial_onu) ??
      serialDeOnuMk(login, c.tecnologia ?? c.Tecnologia);
    if (!login && !mac && !serie) continue;

    autenticacoes.push({
      login,
      mac,
      ip: texto(c.ip ?? c.ip_address ?? c.ipv4 ?? c.ip_conexao),
      contrato: texto(c.contrato ?? c.codcontrato ?? c.cd_contrato),
      serial: serie,
      // Sessão é outra pergunta: o MK não a responde aqui, e bloqueio não a
      // responde por ele. Sem campo explícito, fica "não informado".
      online: simNao(c.online ?? c.conectado ?? c.Online),
      bloqueada,
      fonte: "mk",
    });
  }

  return {
    autenticacoes,
    bloqueada: algumaBloqueada ? true : algumaLiberada ? false : null,
  };
}

/** Aceita inventário do ERP ou leituras OLT. Coincidência é evidência técnica, não prova de posse. */
export function cruzarIdentificadores(
  entrada: { mac?: string | null; serial?: string | null },
  inventario: ReadonlyArray<{
    id: number | string;
    mac?: string | null;
    serial?: string | null;
  }>,
) {
  const mac = normalizarMac(entrada.mac);
  const serie = serial(entrada.serial);
  const porMac = mac
    ? inventario.filter((e) => normalizarMac(e.mac) === mac)
    : [];
  const porSerial = serie
    ? inventario.filter((e) => serial(e.serial) === serie)
    : [];
  const ids = Array.from(new Set([...porMac, ...porSerial].map((e) => e.id)));
  const conflitantes =
    mac &&
    serie &&
    inventario.some(
      (e) =>
        (porMac.includes(e) &&
          serial(e.serial) &&
          serial(e.serial) !== serie) ||
        (porSerial.includes(e) &&
          normalizarMac(e.mac) &&
          normalizarMac(e.mac) !== mac),
    );
  const status =
    !mac && !serie
      ? "sem_identificador"
      : conflitantes ||
          (porMac.length &&
            porSerial.length &&
            !porMac.some((m) => porSerial.some((s) => s.id === m.id)))
        ? "conflito"
        : ids.length > 1
          ? "ambiguo"
          : ids.length === 1
            ? "coincidencia"
            : "nao_localizado";
  return {
    status,
    ids,
    por:
      porMac.length && porSerial.length
        ? "mac_e_serial"
        : porMac.length
          ? "mac"
          : porSerial.length
            ? "serial"
            : null,
  };
}
