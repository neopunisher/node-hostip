import dns from 'node:dns';
import { isIP, isIPv4 } from 'node:net';

/** An IPv4 address as-is, or the first IPv4 address a hostname resolves to. */
export async function toIPv4(target: string): Promise<string> {
  if (isIPv4(target)) return target;
  const { address } = await dns.promises.lookup(target, { family: 4 });
  return address;
}

/** An IPv4 or IPv6 address as-is, or the first IPv4 address a hostname resolves to. */
export async function toIP(target: string): Promise<string> {
  return isIP(target) ? target : toIPv4(target);
}
