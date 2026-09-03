#!/usr/bin/env bash
#
# Habilita o dominio proprio de uma marca white label.
#
#   ./script/dominio-whitelabel.sh app.crednet.com.br
#
# POR QUE ISTO E UM SCRIPT E NAO UMA ROTA DA APLICACAO
#
# Emitir certificado exige root e escrita em /etc/nginx e /etc/letsencrypt. Dar
# isso ao processo Node transformaria qualquer falha da aplicacao em
# comprometimento do servidor. Entao o painel apenas REGISTRA o dominio como
# "pendente", um humano roda este script, e so entao a marca e marcada como
# ativa. A aplicacao nunca afirma que um dominio funciona sem que alguem tenha
# verificado.
#
# ORDEM CORRETA
#   1. superadmin cadastra o dominio no painel  (dominioStatus = pendente)
#   2. o revendedor aponta o DNS para este servidor
#   3. voce roda este script                    (bloco nginx + certificado)
#   4. o painel confirma                        (dominioStatus = ativo)
#
# Rodar antes do DNS propagar faz o certbot falhar na validacao — sem estrago,
# mas e so tentar de novo depois.
#
# VARIAVEIS
#   MAIN_DOMAIN      dominio da plataforma. Lido do .env do projeto quando nao
#                    vier do ambiente. Obrigatorio — ver o motivo abaixo.
#   PORTA            porta do processo Node (padrao 5000)
#   EMAIL_CERTBOT    e-mail de registro no Let's Encrypt
#   CONFIG_PRINCIPAL vhost da plataforma (padrao /etc/nginx/sites-enabled/consultaisp)

set -euo pipefail

DOMINIO="${1:-}"
PORTA="${PORTA:-5000}"
EMAIL_CERTBOT="${EMAIL_CERTBOT:-}"
DISPONIVEIS=/etc/nginx/sites-available
HABILITADOS=/etc/nginx/sites-enabled
# Nome de ARQUIVO do vhost, nao dominio. Trocavel por ambiente porque a
# instalacao pode ter chamado o vhost de outra coisa.
CONFIG_PRINCIPAL="${CONFIG_PRINCIPAL:-$HABILITADOS/consultaisp}"
RAIZ_PROJETO="$(cd "$(dirname "$0")/.." && pwd)"

erro() { echo "ERRO: $*" >&2; exit 1; }
aviso() { echo "AVISO: $*" >&2; }
passo() { echo; echo "── $* ──"; }

[ -n "$DOMINIO" ] || erro "uso: $0 <dominio>   (ex: app.crednet.com.br)"
[ "$(id -u)" = "0" ] || erro "precisa rodar como root."

# ── O dominio da plataforma vem do ambiente, igual ao server/tenant.ts ────────
# Cravado aqui, ele deixaria de proteger EM SILENCIO no dia em que a plataforma
# mudasse de dominio: a checagem logo abaixo e o que impede publicar um
# subdominio da plataforma como se fosse dominio proprio de uma marca — e ali as
# duas regras de resolucao brigariam.
#
# Sem valor nenhum o script PARA, em vez de adivinhar. Um default errado aqui
# aprovaria exatamente o caso que a checagem existe para barrar.
RE_HOSTNAME='^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'

MAIN_DOMAIN="${MAIN_DOMAIN:-}"
if [ -z "$MAIN_DOMAIN" ] && [ -f "$RAIZ_PROJETO/.env" ]; then
  # O `sed` corta o comentario de fim de linha ANTES do `tr`. O `tr` tira aspas e
  # espaco, mas NAO tira `#`: com `MAIN_DOMAIN=x.com.br  # a plataforma` no .env
  # — e o .env.example do projeto usa comentario — o valor viraria
  # "x.com.br#aplataforma". Nao e vazio, entao a checagem abaixo passa, e o
  # `case` mais adiante deixa de casar com qualquer host real: a guarda se
  # desligaria sozinha, EM SILENCIO, que e o que esta secao existe para evitar.
  MAIN_DOMAIN=$(grep -E '^[[:space:]]*MAIN_DOMAIN=' "$RAIZ_PROJETO/.env" | tail -1 \
    | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' | tr -d '"'\''[:space:]' || true)
fi
[ -n "$MAIN_DOMAIN" ] || erro "MAIN_DOMAIN nao definido. Exporte-o ou coloque em $RAIZ_PROJETO/.env — e o mesmo valor que a aplicacao usa."
MAIN_DOMAIN=$(echo "$MAIN_DOMAIN" | tr '[:upper:]' '[:lower:]')

# Valor que nao e hostname nunca deve virar guarda: ele nao barra nada e ninguem
# percebe. Mesmo criterio aplicado ao DOMINIO logo abaixo.
echo "$MAIN_DOMAIN" | grep -Eq "$RE_HOSTNAME" \
  || erro "MAIN_DOMAIN invalido: '$MAIN_DOMAIN'. So o dominio (ex: consultaisp.com.br) — sem protocolo, sem barra, sem comentario na mesma linha do .env."

# Minusculas, sem protocolo, sem barra final — igual ao normalizarHost do app.
DOMINIO=$(echo "$DOMINIO" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##')

echo "$DOMINIO" | grep -Eq "$RE_HOSTNAME" \
  || erro "dominio invalido: $DOMINIO"

case "$DOMINIO" in
  *".$MAIN_DOMAIN"|"$MAIN_DOMAIN")
    erro "dominio da plataforma ($MAIN_DOMAIN) ja e atendido pelo curinga. Use um dominio proprio do revendedor." ;;
esac

# ── 1. O DNS ja aponta para ca? ──────────────────────────────────────────────
passo "Conferindo DNS de $DOMINIO"
IP_SERVIDOR=$(curl -fsS --max-time 10 https://api.ipify.org || true)
IP_DOMINIO=$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1 || true)

if [ -z "$IP_DOMINIO" ]; then
  erro "$DOMINIO nao resolve. O revendedor precisa criar o registro A apontando para ${IP_SERVIDOR:-este servidor}."
elif [ -n "$IP_SERVIDOR" ] && [ "$IP_DOMINIO" != "$IP_SERVIDOR" ]; then
  aviso "$DOMINIO resolve para $IP_DOMINIO, e este servidor e $IP_SERVIDOR."
  aviso "Se o DNS acabou de mudar, espere propagar. O certbot vai falhar ate la."
  read -r -p "Continuar mesmo assim? [s/N] " resposta
  [ "$resposta" = "s" ] || exit 1
else
  echo "ok: $DOMINIO -> $IP_DOMINIO"
fi

# ── 2. O cabecalho de host da config principal ───────────────────────────────
# Com `trust proxy` ligado, o Express prefere X-Forwarded-Host. Se o nginx nao
# sobrescreve esse cabecalho, o valor vem do CLIENTE — e no white label ele
# passa a escolher a marca e o tenant. Sem isto, o resto nao adianta.
passo "Conferindo X-Forwarded-Host na configuracao principal"

# A versao anterior era `[ -f ... ] && ! grep ...` com um `else echo ok`. Se o
# arquivo nao estivesse no caminho cravado, o teste reprovava e o script dizia
# "ok" sem ter olhado NADA — confirmacao de uma protecao que nao foi aplicada.
# Agora: nao achou, reclama e pergunta; achou e nao aplicou, aborta.
if [ ! -f "$CONFIG_PRINCIPAL" ]; then
  aviso "nao achei $CONFIG_PRINCIPAL."
  aviso "NAO consegui conferir se o nginx sobrescreve X-Forwarded-Host. Sem isso, o"
  aviso "cliente escolhe a marca pelo cabecalho. Procure o vhost da plataforma e"
  aviso "garanta que ele tem: proxy_set_header X-Forwarded-Host \$host;"
  read -r -p "Ja conferiu isso na mao? [s/N] " resposta
  [ "$resposta" = "s" ] || exit 1

elif grep -q "X-Forwarded-Host" "$CONFIG_PRINCIPAL"; then
  echo "ok: ja sobrescreve."

else
  aviso "a config principal nao sobrescreve X-Forwarded-Host — o cliente pode forjar o host."
  cp "$CONFIG_PRINCIPAL" "$CONFIG_PRINCIPAL.bak.$(date +%Y%m%d-%H%M%S)"
  sed -i 's|proxy_set_header Host \$host;|proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Host $host;|g' "$CONFIG_PRINCIPAL"

  # O sed sai com 0 mesmo sem casar nada (config com $http_host, outro
  # espacamento, aspas). Conferir a saida e a unica forma de saber.
  if grep -q "X-Forwarded-Host" "$CONFIG_PRINCIPAL"; then
    echo "corrigido (backup salvo ao lado)."
  else
    erro "nao consegui inserir X-Forwarded-Host em $CONFIG_PRINCIPAL — o padrao esperado nao casou. Edite a mao e rode de novo."
  fi
fi

# ── 3. Bloco do dominio ──────────────────────────────────────────────────────
passo "Escrevendo bloco nginx de $DOMINIO"
ARQUIVO="$DISPONIVEIS/whitelabel-$DOMINIO"

if [ -f "$ARQUIVO" ]; then
  echo "ja existe; mantendo e seguindo para o certificado."
else
  cat > "$ARQUIVO" <<CONF
# Marca white label — gerado por script/dominio-whitelabel.sh
# A aplicacao resolve a marca por este host (server/services/marca.service.ts).
server {
    listen 80;
    server_name $DOMINIO;

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        # Sobrescrever e obrigatorio: e este cabecalho que escolhe a marca.
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
    }
}
CONF
  echo "criado: $ARQUIVO"
fi

ln -sf "$ARQUIVO" "$HABILITADOS/whitelabel-$DOMINIO"
nginx -t || erro "configuracao do nginx invalida — nada foi recarregado."
systemctl reload nginx
echo "nginx recarregado."

# ── 4. Certificado ───────────────────────────────────────────────────────────
passo "Emitindo certificado para $DOMINIO"
command -v certbot >/dev/null || erro "certbot nao instalado."

ARGS_EMAIL="--register-unsafely-without-email"
[ -n "$EMAIL_CERTBOT" ] && ARGS_EMAIL="--email $EMAIL_CERTBOT"

if certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos $ARGS_EMAIL --redirect; then
  echo
  echo "PRONTO. https://$DOMINIO esta servindo."
  echo
  echo "Ultimo passo, no painel do superadmin:"
  echo "  marque o dominio desta marca como ATIVO."
  echo "  Ate la a aplicacao trata o dominio como pendente, e os links de e-mail"
  echo "  continuam saindo pelo dominio da plataforma."
else
  erro "certbot falhou. Confira o DNS e tente de novo; o bloco nginx ja esta no lugar."
fi
