/**
 * A máscara do CNPJ do provedor, no endereço que o client já importa.
 *
 * A implementação MUDOU DE ANDAR: mora em `shared/cnpj.ts`, e o porquê inteiro
 * está lá. Em resumo: o servidor também imprime esse CNPJ para uma pessoa ler
 * (o e-mail de boas-vindas é o único que o provedor guarda), não pode importar
 * de `client/`, e uma segunda cópia da máscara é justamente a divergência que a
 * varredura das telas existe para impedir.
 *
 * Este arquivo continua sendo `@/lib/cnpj` para as dez telas que já importavam
 * daqui — e a ficha do superadmin segue reexportando em cascata. Ninguém
 * precisou mudar de import.
 */
export { cnpjCru, cnpjMascarado } from "@shared/cnpj";
