/**
 * Reset de senha local para debug.
 *
 * Uso (PowerShell, dentro de c:\ClaudeCode):
 *   npx tsx script/reset-password-local.ts list
 *   npx tsx script/reset-password-local.ts reset <email> <novaSenha>
 *
 * Lê DATABASE_URL do .env. NÃO usar em produção (use o fluxo de reset
 * normal via email/Resend). Esta ferramenta existe só pra debug local
 * quando você não lembra a senha do seu próprio user.
 */
import "dotenv/config";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { hashPassword } from "../server/password";
import { eq } from "drizzle-orm";

async function list() {
  const rows = await db.select({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    providerId: users.providerId,
  }).from(users).orderBy(users.id);

  console.log(`\n${rows.length} users encontrados:\n`);
  for (const u of rows) {
    const tag = u.role === "superadmin" ? "[SUPERADMIN]" : u.role === "admin" ? "[admin]" : "[user]";
    const provider = u.providerId ? `provider=${u.providerId}` : "—";
    console.log(`  ${tag.padEnd(13)} #${u.id}  ${u.email}  (${u.name})  ${provider}`);
  }
  console.log("");
}

async function reset(email: string, newPassword: string) {
  if (newPassword.length < 6) {
    console.error("Senha precisa ter pelo menos 6 caracteres.");
    process.exit(1);
  }
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    console.error(`User não encontrado: ${email}`);
    console.error(`Roda 'list' primeiro pra ver emails disponíveis.`);
    process.exit(1);
  }
  const hash = await hashPassword(newPassword);
  await db.update(users).set({ password: hash }).where(eq(users.id, existing.id));
  console.log(`\nSenha alterada para ${email} (id=${existing.id}, role=${existing.role}).`);
  console.log(`Faça login agora em http://localhost:5000/login com essa senha.\n`);
}

const [, , cmd, ...args] = process.argv;

(async () => {
  try {
    if (cmd === "list") {
      await list();
    } else if (cmd === "reset" && args[0] && args[1]) {
      await reset(args[0], args[1]);
    } else {
      console.log("Uso:");
      console.log("  npx tsx script/reset-password-local.ts list");
      console.log("  npx tsx script/reset-password-local.ts reset <email> <novaSenha>");
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error("Erro:", err);
    process.exit(1);
  }
})();
