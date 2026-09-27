import { BlockList, isIPv4 } from 'node:net';

// Addresses that never identify a place on the public internet, so there is
// nothing to geolocate. The TEST-NET documentation ranges are left out: they
// don't appear in real traffic, and examples and tests use them as stand-ins
// for public addresses.
const PRIVATE = new BlockList();
PRIVATE.addSubnet('0.0.0.0', 8); // "this network"
PRIVATE.addSubnet('10.0.0.0', 8);
PRIVATE.addSubnet('100.64.0.0', 10); // carrier-grade NAT
PRIVATE.addSubnet('127.0.0.0', 8);
PRIVATE.addSubnet('169.254.0.0', 16);
PRIVATE.addSubnet('172.16.0.0', 12);
PRIVATE.addSubnet('192.0.0.0', 24); // IETF protocol assignments
PRIVATE.addSubnet('192.168.0.0', 16);
PRIVATE.addSubnet('198.18.0.0', 15); // benchmarking
PRIVATE.addSubnet('224.0.0.0', 4); // multicast
PRIVATE.addSubnet('240.0.0.0', 4); // reserved, including 255.255.255.255

/**
 * True for IPv4 addresses that aren't publicly routable: loopback,
 * link-local, RFC 1918, CGNAT, multicast, benchmarking, and reserved space.
 */
export function isPrivateIPv4(ip: string): boolean {
  return isIPv4(ip) && PRIVATE.check(ip, 'ipv4');
}
