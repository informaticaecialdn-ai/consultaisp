/**
 * O script que publica o dominio proprio de uma marca roda como root, no
 * servidor, e escreve vhost e certificado. A unica coisa entre "publicar o
 * dominio do revendedor" e "publicar um subdominio da PLATAFORMA" — que colide
 * com o vhost curinga e quebra o nginx — e a guarda de MAIN_DOMAIN.
 *
 * Essa guarda ja se desligou sozinha, em silencio: o valor era lido do .env com
 * `cut | tr`, e o `tr` tira aspas e espaco mas nao tira `#`. Com um comentario
 * de fim de linha (`MAIN_DOMAIN=consultaisp.com.br  # a plataforma`, e o
 * .env.example do projeto usa comentario) o valor virava
 * "consultaisp.com.br#aplataforma": nao vazio, entao a checagem de existencia
 * passava, e o `case` deixava de casar com qualquer host real.
 *
 * Aqui o script roda DE VERDADE, num diretorio temporario com .env proprio. As
 * tres situacoes abortam antes do DNS, do nginx e do certbot, entao nada do
 * sistema e tocado e nenhuma rede e usada. A unica encenacao e o `id`: uma
 * funcao exportada devolve 0 para o script acreditar que e root e chegar ate a
 * parte que interessa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL = path.join(AQUI, "dominio-whitelabel.sh");

/** Sem bash (Windows sem Git, container minimo) nao ha o que exercitar. */
const TEM_BASH = (() => {
  try {
    return spawnSync("bash", ["-c", "exit 0"]).status === 0;
  } catch {
    return false;
  }
})();

let raiz = "";
let script = "";

/** Caminho que o bash do MSYS tambem entende: `C:/...`, nunca `C:\...`. */
const paraBash = (p: string) => p.replace(/\\/g, "/");

function rodar(env: string, dominio: string) {
  writeFileSync(path.join(raiz, ".env"), env);
  return spawnSync(
    "bash",
    // A funcao exportada vence o `id` do PATH no bash filho: o script checa
    // root antes de qualquer outra coisa e pararia ali.
    ["-c", 'id() { echo 0; }; export -f id; exec bash "$1" "$2"', "_", paraBash(script), dominio],
    { encoding: "utf8", timeout: 30_000, env: { ...process.env, MAIN_DOMAIN: "" } },
  );
}

beforeAll(() => {
  if (!TEM_BASH) return;
  raiz = mkdtempSync(path.join(tmpdir(), "whitelabel-"));
  mkdirSync(path.join(raiz, "script"));
  script = path.join(raiz, "script", "dominio-whitelabel.sh");
  copyFileSync(ORIGINAL, script);
});

afterAll(() => {
  if (raiz) rmSync(raiz, { recursive: true, force: true });
});

describe.skipIf(!TEM_BASH)("script/dominio-whitelabel.sh — a guarda de MAIN_DOMAIN", () => {
  it("comentario de fim de linha no .env nao desliga a guarda", () => {
    const r = rodar("MAIN_DOMAIN=consultaisp.com.br  # dominio da plataforma\n", "cliente.consultaisp.com.br");
    expect(r.stderr).toMatch(/dominio da plataforma/i);
    expect(r.status).toBe(1);
    // O que acontecia antes: passava direto e ia emitir vhost + certificado.
    expect(r.stdout).not.toMatch(/Conferindo DNS/);
  });

  it("aspas, maiusculas e comentario juntos continuam dando o mesmo valor", () => {
    const r = rodar('# a plataforma\nMAIN_DOMAIN="ConsultaISP.com.br" # nao mexer\n', "CLIENTE.consultaisp.com.BR");
    expect(r.stderr).toMatch(/dominio da plataforma \(consultaisp\.com\.br\)/i);
    expect(r.status).toBe(1);
  });

  it("MAIN_DOMAIN que nao e hostname aborta, em vez de virar guarda que nao barra nada", () => {
    const r = rodar("MAIN_DOMAIN=https://consultaisp.com.br/\n", "cliente.consultaisp.com.br");
    expect(r.stderr).toMatch(/MAIN_DOMAIN invalido/i);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/Conferindo DNS/);
  });

  it("sem MAIN_DOMAIN nenhum o script para, em vez de adivinhar", () => {
    const r = rodar("# nada aqui\n", "app.crednet.com.br");
    expect(r.stderr).toMatch(/MAIN_DOMAIN nao definido/i);
    expect(r.status).toBe(1);
  });
});
