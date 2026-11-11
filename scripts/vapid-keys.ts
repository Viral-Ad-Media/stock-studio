/**
 * Generates a fresh P-256 VAPID keypair for Web Push notifications.
 *
 * Run: npm run vapid-keys
 * Paste the two lines into .env.local (and your host's environment settings).
 */
import { generateVapidKeys } from "../lib/push";

async function main() {
  const { publicKey, privateKey } = await generateVapidKeys();
  console.log("# Web Push VAPID keys (RFC 8292 P-256)");
  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
