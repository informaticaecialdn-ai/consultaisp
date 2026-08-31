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

set -euo pipefail

DOMINIO="${1:-}"
PORTA="${PORTA:-5000}"
EMAIL_CERTBOT="${EMAIL_CERTBOT:-}"
DISPONIVEIS=/etc/nginx/sites-available
HABILITADOS=/etc/nginx/sites-enabled
CONFIG_PRINCIPAL="$HABILITADOS/consultaisp"

erro() { echo "ERRO: $*" >&2; exit 1; }
aviso() { echo "AVISO: $*" >&2; }
passo() { echo; echo "── $* ──"; }

[ -n "$DOMINIO" ] || erro "uso: $0 <dominio>   (ex: app.crednet.com.br)"
[ "$(id -u)" = "0" ] || erro "precisa rodar como root."

# Minusculas, sem protocolo, sem barra final — igual ao normalizarHost do app.
DOMINIO=$(echo "$DOMINIO" | tr '[:upper:]' '[:lower:]' | sed -e 's#^https\?://##' -e 's#/.*$##')

echo "$DOMINIO" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
  || erro "dominio invalido: $DOMINIO"

case "$DOMINIO" in
  *.consultaisp.com.br|consultaisp.com.br)
    erro "dominio da plataforma ja e atendido pelo curinga. Use um dominio proprio do revendedor." ;;
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
