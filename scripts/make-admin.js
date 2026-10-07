#!/usr/bin/env node
/*
 * Approves a registered account and makes it an admin. Run it where the app's DATABASE_URL is set:
 *   npm run make-admin -- someone@example.com
 * The person must have registered first (Register tab on the sign-in page). Only someone with access
 * to the server/database can run this, which is what makes it safe as a way to create the first admin.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run make-admin -- <email>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No account for ${email}. Register on the sign-in page first, then run this again.`);
      process.exit(2);
    }
    await prisma.user.update({ where: { id: user.id }, data: { status: 'APPROVED', role: 'ADMIN', decidedBy: 'make-admin script', decidedAt: new Date() } });
    await prisma.auditLog.create({ data: { actor: 'make-admin script', action: 'USER_ROLE_ADMIN', meta: { userId: user.id, email } } });
    console.log(`${user.name} <${email}> is now an approved admin. Sign in with email and password.`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((err) => { console.error(err.message); process.exit(1); });
