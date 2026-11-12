import { isIP } from "node:net";

export function webhookCallerIp(socketIp: string, forwarded?: string | string[]): string {
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const addresses = value?.split(",").map((ip) => ip.trim()) ?? [];
  const caller = addresses.length >= 2
    ? addresses[addresses.length - 2]
    : addresses[0] ?? socketIp;
  return isIP(caller) ? caller : socketIp;
}
