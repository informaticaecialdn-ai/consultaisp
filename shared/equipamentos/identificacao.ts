/** Dados técnicos permitidos no Cliente 360. Nunca transportar senha PPPoE. */
export interface AutenticacaoCliente {
  login: string | null;
  mac: string | null;
  ip: string | null;
  contrato: string | null;
  serial: string | null;
  online: boolean | null;
  fonte: string;
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
